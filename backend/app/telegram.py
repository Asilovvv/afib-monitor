"""Telegram bot: AF alerts with the ECG strip and an "Accept" button, for the doctor and the patient's relatives.

Set TELEGRAM_BOT_TOKEN (from @BotFather). On Render the bot uses a webhook at
<RENDER_EXTERNAL_URL>/api/telegram/webhook, so a message to the bot also wakes a sleeping server;
without a public URL (local run) it falls back to long polling.

Linking: the doctor (portal → Settings) or the patient (app → Profile → "Relatives") gets a one-time
link t.me/<bot>?start=<code>; opening it in Telegram and pressing Start links that chat.
"""
from __future__ import annotations

import asyncio
import hashlib
import html
import os
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

from .db import SessionLocal
from .events import broker
from .models import (STATE_AFIB, STATE_NORMAL, Alert, AlertAck, EcgStrip, Reading, TelegramCode,
                     TelegramLink, TelegramMessage, User)

TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
API_BASE = os.getenv("TELEGRAM_API", "https://api.telegram.org")
PUBLIC_URL = (os.getenv("PUBLIC_URL") or os.getenv("RENDER_EXTERNAL_URL") or "").rstrip("/")
TZ = timezone(timedelta(hours=float(os.getenv("TZ_OFFSET_HOURS", "6"))))     # Asia/Bishkek
SECRET = hashlib.sha256(("afib:" + TOKEN).encode()).hexdigest()[:32]
ECG_WAIT_S = float(os.getenv("TELEGRAM_ECG_WAIT_S", "20"))   # wait this long for the onset ECG before sending
# Alert only for AF that lasts >= 30 s (clinical definition of an episode). On MIT-BIH (leave-one-patient-out)
# this rule cuts false alarms from 4.6 to 0.91 per hour, but only 205 of 226 episodes then alert (ml/LOPO_RESULTS.md).
CONFIRM_S = float(os.getenv("TELEGRAM_CONFIRM_S", "30"))
MAX_AGE = timedelta(minutes=10)                                  # do not page anyone about old, synced-later alerts
COOLDOWN = timedelta(minutes=float(os.getenv("TELEGRAM_COOLDOWN_MIN", "15")))  # per patient per chat
CODE_TTL = timedelta(hours=24)

bot_username: str | None = os.getenv("TELEGRAM_BOT_USERNAME") or None
_client = None
_last_sent: dict[tuple[int, int], datetime] = {}


def enabled() -> bool:
    return bool(TOKEN)


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def local(dt: datetime) -> str:
    return dt.replace(tzinfo=timezone.utc).astimezone(TZ).strftime("%d.%m %H:%M")


# ------------------------------------------------------------------ Telegram HTTP API
async def _call(method: str, data: dict | None = None, files: dict | None = None) -> dict:
    global _client
    import httpx
    if _client is None:
        _client = httpx.AsyncClient(timeout=40)
    r = await _client.post(f"{API_BASE}/bot{TOKEN}/{method}", data=data if files else None,
                           json=None if files else data, files=files)
    j = r.json()
    if not j.get("ok"):
        print("telegram", method, j.get("description"))
    return j


def _spawn(coro):
    """Run a coroutine on the server loop; safe to call from sync handlers in the thread pool."""
    if not enabled() or broker.loop is None:
        coro.close()
        return
    broker.loop.call_soon_threadsafe(lambda: broker.loop.create_task(_guard(coro)))


async def _guard(coro):
    try:
        await coro
    except Exception as e:  # a Telegram failure must never break the medical data path
        print("telegram error:", type(e).__name__, e)


# ------------------------------------------------------------------ startup: webhook or polling
async def start():
    global bot_username
    if not enabled():
        return
    me = await _call("getMe")
    bot_username = (me.get("result") or {}).get("username", bot_username)
    await _call("setMyCommands", {"commands": [
        {"command": "status", "description": "Текущий ритм / Учурдагы ритм"},
        {"command": "stop", "description": "Отключить уведомления"},
        {"command": "help", "description": "Помощь"}]})
    if PUBLIC_URL:
        await _call("setWebhook", {"url": f"{PUBLIC_URL}/api/telegram/webhook", "secret_token": SECRET,
                                   "allowed_updates": ["message", "callback_query"]})
        print("telegram: webhook", PUBLIC_URL, "@" + str(bot_username))
    else:
        await _call("deleteWebhook")
        asyncio.get_running_loop().create_task(_poll())
        print("telegram: polling @" + str(bot_username))


async def _poll():
    offset = 0
    while True:
        try:
            j = await _call("getUpdates", {"offset": offset, "timeout": 30,
                                           "allowed_updates": ["message", "callback_query"]})
            for u in j.get("result", []):
                offset = u["update_id"] + 1
                await handle_update(u)
        except Exception as e:
            print("telegram poll:", e)
            await asyncio.sleep(5)


# ------------------------------------------------------------------ linking
def new_code(db, user: User) -> str:
    kind = "doctor" if user.role == "doctor" else "family"
    db.execute(delete(TelegramCode).where(TelegramCode.created_at < utcnow() - CODE_TTL))
    code = secrets.token_urlsafe(9).replace("-", "x").replace("_", "y")[:12]
    db.add(TelegramCode(code=code, kind=kind, user_id=user.id, created_at=utcnow()))
    db.commit()
    return code


def link_url(code: str) -> str | None:
    return f"https://t.me/{bot_username}?start={code}" if bot_username else None


def links_of(db, user: User) -> list[dict]:
    kind = "doctor" if user.role == "doctor" else "family"
    return [{"id": l.id, "name": l.name, "kind": l.kind, "created_at": l.created_at.isoformat() + "Z"}
            for l in db.scalars(select(TelegramLink).where(TelegramLink.user_id == user.id,
                                                           TelegramLink.kind == kind))]


def recipients(db, patient: User) -> list[TelegramLink]:
    q = select(TelegramLink).where(
        ((TelegramLink.kind == "family") & (TelegramLink.user_id == patient.id))
        | ((TelegramLink.kind == "doctor") & (TelegramLink.user_id == (patient.doctor_id or -1))))
    seen, out = set(), []
    for l in db.scalars(q.order_by(TelegramLink.kind)):        # doctor first
        if l.chat_id not in seen:
            seen.add(l.chat_id)
            out.append(l)
    return out


# ------------------------------------------------------------------ alerts
def notify_alert(alert_id: int):
    _spawn(_send_alert(alert_id))


def notify_ecg(strip_id: int):
    _spawn(_send_late_ecg(strip_id))


def notify_ack(alert_id: int):
    _spawn(_refresh(alert_id))


def _alert_text(db, a: Alert, p: User) -> str:
    lines = [f"🔴 <b>Фибрилляция предсердий</b>",
             f"Пациент: <b>{html.escape(p.name)}</b>",
             f"Время: {local(a.ts)}",
             f"ЧСС {round(a.bpm)} уд/мин · вероятность {round(a.prob * 100)}%"]
    acks = list(db.scalars(select(AlertAck).where(AlertAck.alert_id == a.id).order_by(AlertAck.ts)))
    if acks:
        lines.append("")
        for k in acks:
            role = "врач" if k.kind == "doctor" else "близкий"
            lines.append(f"✅ Принял(а): {html.escape(k.who)} ({role}), {local(k.ts)}")
    elif a.status == "new":
        lines.append("\nНажмите «Принять», чтобы врач и семья видели, что тревогу заметили.")
    return "\n".join(lines)


def _markup(a: Alert, chat_acked: bool, is_doctor: bool) -> dict:
    rows = []
    if not chat_acked:
        rows.append([{"text": "✅ Принять", "callback_data": f"ack:{a.id}"}])
    if is_doctor and PUBLIC_URL:
        rows.append([{"text": "Открыть в кабинете врача", "url": f"{PUBLIC_URL}/app/patients/{a.patient_id}"}])
    return {"inline_keyboard": rows}


def _strip_for(db, a: Alert) -> EcgStrip | None:
    return db.scalar(select(EcgStrip).where(EcgStrip.patient_id == a.patient_id,
                                            EcgStrip.ts >= a.ts - timedelta(seconds=90),
                                            EcgStrip.ts <= a.ts + timedelta(minutes=3))
                     .order_by(EcgStrip.ts.desc()).limit(1))


def _ecg_png(strip: EcgStrip, p: User) -> bytes:
    import json as _j
    from . import ecgtools
    x = _j.loads(strip.samples)
    return ecgtools.png(x, strip.fs, title=f"ФП · {p.name}", subtitle=f"{local(strip.ts)}  ЧСС {round(strip.bpm)}",
                        af=strip.state == STATE_AFIB)


def _sustained(db, a: Alert) -> bool | None:
    """True: still AF CONFIRM_S after onset; False: rhythm went back to normal; None: no data yet."""
    end = a.ts + timedelta(seconds=CONFIRM_S)
    rows = list(db.execute(select(Reading.ts, Reading.state).where(
        Reading.patient_id == a.patient_id, Reading.ts >= a.ts).order_by(Reading.ts).limit(400)))
    if any(st == STATE_NORMAL and ts <= end for ts, st in rows):
        return False
    return True if any(ts >= end for ts, _ in rows) else None


async def _send_alert(alert_id: int):
    with SessionLocal() as db:
        a = db.get(Alert, alert_id)
        if a is None or utcnow() - a.ts > MAX_AGE:
            return
    # 1) confirm the episode: AF must last CONFIRM_S (waits up to CONFIRM_S + 60 s for the phone's uploads)
    waited = 0.0
    while CONFIRM_S > 0:
        with SessionLocal() as db:
            ok = _sustained(db, db.get(Alert, alert_id))
        if ok is False:
            return                                               # short run, not an episode: no page
        if ok or waited >= CONFIRM_S + 60:
            break                                                # confirmed, or data stopped: alert to be safe
        await asyncio.sleep(3)
        waited += 3
    # 2) give the phone a moment to upload the onset ECG, so the first message already carries the picture
    waited = 0.0
    while True:
        with SessionLocal() as db:
            a = db.get(Alert, alert_id)
            if a is None:
                return
            strip = _strip_for(db, a)
        if strip is not None or waited >= ECG_WAIT_S:
            break
        await asyncio.sleep(2)
        waited += 2
    with SessionLocal() as db:
        a = db.get(Alert, alert_id)
        p = db.get(User, a.patient_id)
        targets = [(l.chat_id, l.kind == "doctor") for l in recipients(db, p)]
        text = _alert_text(db, a, p)
        png = _ecg_png(strip, p) if strip is not None else None
    now = utcnow()
    for chat_id, is_doc in targets:
        key = (chat_id, a.patient_id)
        if key in _last_sent and now - _last_sent[key] < COOLDOWN:
            continue
        _last_sent[key] = now
        mk = _markup(a, False, is_doc)
        if png:
            import json as _j
            r = await _call("sendPhoto", {"chat_id": str(chat_id), "caption": text, "parse_mode": "HTML",
                                          "reply_markup": _j.dumps(mk)},
                            files={"photo": ("ecg.png", png, "image/png")})
        else:
            r = await _call("sendMessage", {"chat_id": chat_id, "text": text, "parse_mode": "HTML",
                                            "reply_markup": mk})
        if r.get("ok"):
            with SessionLocal() as db:
                db.add(TelegramMessage(alert_id=a.id, chat_id=chat_id, message_id=r["result"]["message_id"],
                                       has_photo=1 if png else 0))
                db.commit()


async def _send_late_ecg(strip_id: int):
    """ECG arrived after a text-only alert went out: send the picture as a reply."""
    with SessionLocal() as db:
        s = db.get(EcgStrip, strip_id)
        if s is None or s.reason != "afib_onset":
            return
        a = db.scalar(select(Alert).where(Alert.patient_id == s.patient_id, Alert.ts <= s.ts + timedelta(seconds=90),
                                          Alert.ts >= s.ts - timedelta(minutes=3)).order_by(Alert.ts.desc()).limit(1))
        if a is None:
            return
        msgs = [(m.chat_id, m.message_id) for m in db.scalars(
            select(TelegramMessage).where(TelegramMessage.alert_id == a.id, TelegramMessage.has_photo == 0))]
        if not msgs:
            return
        p = db.get(User, s.patient_id)
        png = _ecg_png(s, p)
    for chat_id, mid in msgs:
        await _call("sendPhoto", {"chat_id": str(chat_id), "reply_to_message_id": str(mid),
                                  "caption": f"ЭКГ в начале эпизода · {html.escape(p.name)}"},
                    files={"photo": ("ecg.png", png, "image/png")})


async def _refresh(alert_id: int):
    """Re-render every copy of the alert (who accepted it; remove the button where it was pressed)."""
    with SessionLocal() as db:
        a = db.get(Alert, alert_id)
        if a is None:
            return
        p = db.get(User, a.patient_id)
        text = _alert_text(db, a, p)
        acked_chats = {k.chat_id for k in db.scalars(select(AlertAck).where(AlertAck.alert_id == a.id))}
        doctor_acked = a.status == "ack"
        docs = {l.chat_id for l in recipients(db, p) if l.kind == "doctor"}
        msgs = [(m.chat_id, m.message_id, m.has_photo) for m in db.scalars(
            select(TelegramMessage).where(TelegramMessage.alert_id == a.id))]
    for chat_id, mid, photo in msgs:
        is_doc = chat_id in docs
        mk = _markup(a, chat_id in acked_chats or (is_doc and doctor_acked), is_doc)
        if photo:
            await _call("editMessageCaption", {"chat_id": chat_id, "message_id": mid, "caption": text,
                                               "parse_mode": "HTML", "reply_markup": mk})
        else:
            await _call("editMessageText", {"chat_id": chat_id, "message_id": mid, "text": text,
                                            "parse_mode": "HTML", "reply_markup": mk})


def record_ack(db, a: Alert, who: str, kind: str, chat_id: int | None, doctor_id: int | None = None):
    if chat_id is None and a.status == "ack":
        return
    if chat_id is not None and db.scalar(select(AlertAck).where(AlertAck.alert_id == a.id,
                                                                AlertAck.chat_id == chat_id)):
        return
    db.add(AlertAck(alert_id=a.id, who=who, kind=kind, chat_id=chat_id, ts=utcnow()))
    if kind == "doctor" and a.status == "new":
        a.status, a.ack_by, a.ack_at = "ack", doctor_id, utcnow()
    db.commit()


# ------------------------------------------------------------------ incoming updates
HELP = ("Я присылаю тревоги о фибрилляции предсердий (ФП) с ЭКГ.\n\n"
        "• Врач: кабинет врача → Настройки → «Подключить Telegram».\n"
        "• Близкие: приложение пациента → Профиль → «Близкие в Telegram».\n\n"
        "/status — текущий ритм\n/stop — отключить уведомления\n\n"
        "Мен ЭКГ менен жүрөк дирилдөөсү (ФП) тууралуу эскертүүлөрдү жиберем.")


async def handle_update(u: dict):
    if "callback_query" in u:
        return await _on_callback(u["callback_query"])
    m = u.get("message") or {}
    chat = (m.get("chat") or {}).get("id")
    text = (m.get("text") or "").strip()
    if not chat or not text:
        return
    sender = m.get("from") or {}
    name = " ".join(x for x in (sender.get("first_name"), sender.get("last_name")) if x) or "Telegram"
    cmd, _, arg = text.partition(" ")
    cmd = cmd.split("@")[0].lower()
    if cmd == "/start" and arg:
        reply = await asyncio.to_thread(_link, chat, arg.strip(), name)
    elif cmd == "/status":
        reply = await asyncio.to_thread(_status, chat)
    elif cmd == "/stop":
        reply = await asyncio.to_thread(_unlink, chat)
    else:
        reply = "Здравствуйте! " + HELP
    await _call("sendMessage", {"chat_id": chat, "text": reply, "parse_mode": "HTML"})


def _link(chat: int, code: str, name: str) -> str:
    with SessionLocal() as db:
        c = db.get(TelegramCode, code)
        if c is None or utcnow() - c.created_at > CODE_TTL:
            return "Ссылка устарела или неверна. Получите новую в приложении или в кабинете врача."
        u = db.get(User, c.user_id)
        if not db.scalar(select(TelegramLink).where(TelegramLink.chat_id == chat, TelegramLink.kind == c.kind,
                                                    TelegramLink.user_id == c.user_id)):
            db.add(TelegramLink(chat_id=chat, kind=c.kind, user_id=c.user_id, name=name[:200], created_at=utcnow()))
        db.delete(c)
        db.commit()
        broker.publish(u.id if u.role == "doctor" else u.doctor_id, "telegram", {"user_id": u.id})
        if c.kind == "doctor":
            return (f"✅ Готово, {html.escape(u.name)}. Сюда будут приходить тревоги ФП по всем вашим пациентам "
                    f"с ЭКГ и кнопкой «Принять».\n/status — кто сейчас в ФП")
        return (f"✅ Готово. Вы будете получать тревоги ФП пациента <b>{html.escape(u.name)}</b> с ЭКГ.\n"
                f"/status — текущий ритм")


def _unlink(chat: int) -> str:
    with SessionLocal() as db:
        n = db.execute(delete(TelegramLink).where(TelegramLink.chat_id == chat)).rowcount
        db.commit()
    return "Уведомления отключены." if n else "Этот чат не был подключён."


def _status(chat: int) -> str:
    with SessionLocal() as db:
        links = list(db.scalars(select(TelegramLink).where(TelegramLink.chat_id == chat)))
        if not links:
            return "Этот чат не подключён. " + HELP
        pats: list[User] = []
        for l in links:
            if l.kind == "doctor":
                pats += list(db.scalars(select(User).where(User.doctor_id == l.user_id)))
            else:
                pats.append(db.get(User, l.user_id))
        now = utcnow()
        out = []
        for p in {p.id: p for p in pats}.values():
            r = db.scalar(select(Reading).where(Reading.patient_id == p.id).order_by(Reading.ts.desc()).limit(1))
            if r is None or now - r.ts > timedelta(minutes=2):
                st = "⚪ нет связи" + (f" (с {local(r.ts)})" if r else "")
            elif r.state == STATE_AFIB:
                st = f"🔴 ФП, {round(r.bpm)} уд/мин"
            elif r.state == STATE_NORMAL:
                st = f"🟢 норма, {round(r.bpm)} уд/мин"
            else:
                st = "🟡 накопление данных"
            out.append((r is None or r.state != STATE_AFIB, p.name, f"{html.escape(p.name)} — {st}"))
        out.sort()
        return "<b>Сейчас</b>\n" + "\n".join(x[2] for x in out[:40])


async def _on_callback(q: dict):
    chat = ((q.get("message") or {}).get("chat") or {}).get("id")
    data = q.get("data") or ""
    sender = q.get("from") or {}
    name = " ".join(x for x in (sender.get("first_name"), sender.get("last_name")) if x) or "Telegram"
    answer = "Нет доступа"
    if data.startswith("ack:") and chat:
        answer = await asyncio.to_thread(_ack_from_chat, chat, int(data[4:]), name)
    await _call("answerCallbackQuery", {"callback_query_id": q["id"], "text": answer})
    if data.startswith("ack:"):
        await _refresh(int(data[4:]))


def _ack_from_chat(chat: int, alert_id: int, name: str) -> str:
    with SessionLocal() as db:
        a = db.get(Alert, alert_id)
        if a is None:
            return "Тревога не найдена"
        p = db.get(User, a.patient_id)
        for l in recipients(db, p):
            if l.chat_id != chat:
                continue
            if l.kind == "doctor":
                doc = db.get(User, l.user_id)
                record_ack(db, a, doc.name, "doctor", chat, doc.id)
                broker.publish(doc.id, "alert_ack", {"id": a.id, "patient_id": p.id})
            else:
                record_ack(db, a, name, "family", chat)
                broker.publish(p.doctor_id, "alert_ack", {"id": a.id, "patient_id": p.id, "family": name})
            return "Принято ✅"
    return "Нет доступа к этому пациенту"
