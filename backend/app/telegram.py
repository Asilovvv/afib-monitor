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
import re
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

from .db import SessionLocal
from .events import broker
from .bot_texts import t as bt
from .models import (STATE_AFIB, STATE_NORMAL, Alert, AlertAck, CheckPlan, Device, DeviceIssue, EcgStrip, FamilyLink, Reading, TelegramCode,
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
def new_code(db, user: User, kind: str | None = None) -> str:
    """kind: doctor (all his patients), patient (the patient's own chat: reminders, typing values, weekly summary),
    family (a relative's chat linked to the patient, or a watcher account's chat)."""
    if kind not in ("doctor", "patient", "family"):
        kind = "doctor" if user.role == "doctor" else "family"
    if user.role == "doctor":
        kind = "doctor"
    if kind == "patient" and user.role != "patient":
        kind = "family"
    db.execute(delete(TelegramCode).where(TelegramCode.created_at < utcnow() - CODE_TTL))
    code = secrets.token_urlsafe(9).replace("-", "x").replace("_", "y")[:12]
    db.add(TelegramCode(code=code, kind=kind, user_id=user.id, created_at=utcnow()))
    db.commit()
    return code


def link_url(code: str) -> str | None:
    return f"https://t.me/{bot_username}?start={code}" if bot_username else None


def links_of(db, user: User) -> list[dict]:
    kinds = ("doctor",) if user.role == "doctor" else ("family", "patient")
    return [{"id": l.id, "name": l.name, "kind": l.kind, "created_at": l.created_at.isoformat() + "Z"}
            for l in db.scalars(select(TelegramLink).where(TelegramLink.user_id == user.id,
                                                           TelegramLink.kind.in_(kinds)))]


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


# ------------------------------------------------------------------ family: plain-word daily messages
TZ_HOURS = float(os.getenv("TZ_OFFSET_HOURS", "6"))
NUDGE_LOCAL_HOUR = 14
_nudged: set[tuple[int, str]] = set()        # (patient_id, local day) already reminded, per process


def chat_lang(db, chat: int) -> str:
    l = db.scalar(select(TelegramLink.lang).where(TelegramLink.chat_id == chat, TelegramLink.lang.is_not(None)))
    return l or "ru"


def family_chat_langs(db, patient_id: int) -> dict[int, str]:
    """chat id → language, for relatives' chats."""
    watchers = [l.watcher_id for l in db.scalars(select(FamilyLink).where(FamilyLink.patient_id == patient_id,
                                                                            FamilyLink.revoked_at.is_(None)))]
    q = select(TelegramLink.chat_id, TelegramLink.lang).where(TelegramLink.kind == "family",
                                                              TelegramLink.user_id.in_([patient_id] + watchers))
    return {c: (l or "ru") for c, l in db.execute(q)}


def patient_chat_langs(db, patient_id: int) -> dict[int, str]:
    q = select(TelegramLink.chat_id, TelegramLink.lang).where(TelegramLink.kind == "patient", TelegramLink.user_id == patient_id)
    return {c: (l or "ru") for c, l in db.execute(q)}


def verdict_words(lang: str, verdict: str) -> str:
    return bt(lang, f"verdict_{verdict}") if verdict in ("regular", "irregular", "no_verdict") else verdict


def family_chats(db, patient_id: int) -> list[int]:
    """Telegram chats of relatives: linked straight to the patient (kind family) or to a watcher account."""
    watchers = [l.watcher_id for l in db.scalars(select(FamilyLink).where(FamilyLink.patient_id == patient_id,
                                                                            FamilyLink.revoked_at.is_(None)))]
    q = select(TelegramLink.chat_id).where(TelegramLink.kind == "family",
                                           TelegramLink.user_id.in_([patient_id] + watchers))
    return sorted(set(db.scalars(q)))


def notify_family_check(patient_id: int, verdict: str):
    """After a 30-s check: one short message to the relatives, wellness words only."""
    if not enabled():
        return
    _spawn(_send_family(patient_id, verdict))


async def _send_family(patient_id: int, verdict: str):
    with SessionLocal() as db:
        p = db.get(User, patient_id)
        chats = family_chat_langs(db, patient_id)
    if not p or not chats:
        return
    first = html.escape(p.name.split()[0])
    for chat, lang in chats.items():
        await _call("sendMessage", {"chat_id": str(chat), "text": bt(lang, "family_check", name=first, verdict=verdict_words(lang, verdict))})


_reminded: set[tuple[int, str]] = set()      # (patient_id, local slot "YYYY-MM-DDTHH:MM") already reminded


async def _check_reminders(now: datetime, local: datetime):
    """Within 10 minutes after each planned slot: "time for your rhythm check" to the patient's own chat."""
    day = local.date().isoformat()
    hm = local.strftime("%H:%M")
    todo = []
    with SessionLocal() as db:
        for plan in db.scalars(select(CheckPlan).where(CheckPlan.active.is_(True))):
            chats = patient_chat_langs(db, plan.patient_id)
            if not chats or not plan.times:
                continue
            for t in plan.times.split(","):
                key = (plan.patient_id, f"{day}T{t}")
                if key in _reminded or not (t <= hm <= f"{int(t[:2]):02d}:{min(59, int(t[3:]) + 10):02d}"):
                    continue
                _reminded.add(key)
                todo.append((t, chats))
    for t_, chats in todo:
        for chat, lang in chats.items():
            await _call("sendMessage", {"chat_id": str(chat), "text": bt(lang, "reminder_check", t=t_)})


ADMIN_CHAT = os.getenv("TELEGRAM_ADMIN_CHAT", "").strip()      # your own chat id: invoice requests land here


def notify_admin(text: str):
    """Operational note to the project owner's chat (plan requests). No patient data, only clinic contact."""
    if not enabled() or not ADMIN_CHAT:
        return
    _spawn(_call("sendMessage", {"chat_id": ADMIN_CHAT, "text": "🧾 " + html.escape(text)}))


def notify_patient_seen(patient_id: int, doctor_name: str, action: str, strip_ts: datetime):
    """"Your doctor looked at your recording": to the patient's own chat. The single strongest reason to keep checking."""
    if not enabled():
        return
    _spawn(_send_seen(patient_id, doctor_name, action, strip_ts))


async def _send_seen(patient_id: int, doctor_name: str, action: str, strip_ts: datetime):
    with SessionLocal() as db:
        chats = patient_chat_langs(db, patient_id)
    for chat, lang in chats.items():
        what = bt(lang, "seen_seen" if action == "seen" else "seen_call")
        await _call("sendMessage", {"chat_id": str(chat), "text": bt(lang, "seen", doctor=html.escape(doctor_name), what=what, when=local(strip_ts))})


async def _return_reminders(now: datetime, local: datetime):
    """Clinic rental: the day before a box is due and each day it is overdue, one message to the doctor's chat and one
    to the patient's own chat (if linked). Once a day per loan; after 09:00 local."""
    if local.hour < 9:
        return
    todo = []
    with SessionLocal() as db:
        q = select(DeviceIssue).where(DeviceIssue.returned_at.is_(None), DeviceIssue.due_at <= now + timedelta(hours=24))
        for i in db.scalars(q):
            if i.reminded_at and now - i.reminded_at < timedelta(hours=23):
                continue
            d = db.get(Device, i.device_id)
            p = db.get(User, i.patient_id)
            if not d or not p:
                continue
            doc_chats = list(db.scalars(select(TelegramLink.chat_id).where(TelegramLink.kind == "doctor", TelegramLink.user_id == d.owner_id)))
            pat_chats = patient_chat_langs(db, p.id)
            if not doc_chats and not pat_chats:
                continue
            i.reminded_at = now
            overdue = now > i.due_at
            due = local_date(i.due_at)
            todo.append((doc_chats, f"📦 Датчик {d.label or d.chip_id.upper()} у пациента {html.escape(p.name)}: "
                                    + (f"срок возврата истёк {due}." if overdue else f"возврат завтра, {due}.")))
            for chat, lang in pat_chats.items():
                when = bt(lang, "return_overdue", d=due) if overdue else bt(lang, "return_tomorrow", d=due)
                todo.append(([chat], bt(lang, "return_patient", when=when)))
        db.commit()
    for chats, text in todo:
        for chat in chats:
            await _call("sendMessage", {"chat_id": str(chat), "text": text})


def local_date(dt: datetime) -> str:
    return (dt + timedelta(hours=TZ_HOURS)).strftime("%d.%m.%Y")


async def family_nudges():
    """Every 10 minutes: planned-check reminders to patients; after 14:00 local, if a patient with an active plan and
    relatives has not checked today, tell the relatives once. Gentle reminders, never alarms."""
    while True:
        try:
            if enabled():
                now = utcnow()
                local = now + timedelta(hours=TZ_HOURS)
                await _check_reminders(now, local)
                await _return_reminders(now, local)
                if local.hour >= NUDGE_LOCAL_HOUR:
                    day = local.date().isoformat()
                    day0 = datetime.combine(local.date(), datetime.min.time()) - timedelta(hours=TZ_HOURS)
                    with SessionLocal() as db:
                        todo = []
                        for plan in db.scalars(select(CheckPlan).where(CheckPlan.active.is_(True))):
                            if (plan.patient_id, day) in _nudged:
                                continue
                            chats = family_chat_langs(db, plan.patient_id)
                            if not chats:
                                continue
                            done = db.scalar(select(EcgStrip.id).where(EcgStrip.patient_id == plan.patient_id,
                                                                       EcgStrip.reason == "check", EcgStrip.ts >= day0).limit(1))
                            if done:
                                _nudged.add((plan.patient_id, day))
                                continue
                            p = db.get(User, plan.patient_id)
                            todo.append((plan.patient_id, p.name.split()[0] if p else "?", chats))
                    for pid, first, chats in todo:
                        _nudged.add((pid, day))
                        for chat, lang in chats.items():
                            await _call("sendMessage", {"chat_id": str(chat), "text": bt(lang, "nudge_family", name=html.escape(first))})
        except Exception as e:                      # never let the loop die
            print("family nudges", e)
        await asyncio.sleep(600)


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
HELP = bt("ru", "help_public")
PATIENT_HELP = bt("ru", "help_patient")


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
    tg_lang = (sender.get("language_code") or "")[:2].lower()
    if cmd == "/start" and arg:
        reply = await asyncio.to_thread(_link, chat, arg.strip(), name, tg_lang)
    elif cmd in ("/ky", "/kg", "/кыргызча"):
        reply = await asyncio.to_thread(_set_lang, chat, "ky")
    elif cmd in ("/ru", "/русский"):
        reply = await asyncio.to_thread(_set_lang, chat, "ru")
    elif cmd == "/status":
        reply = await asyncio.to_thread(_status, chat)
    elif cmd == "/stop":
        reply = await asyncio.to_thread(_unlink, chat)
    elif cmd in ("/week", "/неделя", "/жума"):
        reply = await asyncio.to_thread(_week, chat)
    elif cmd in ("/help", "/помощь"):
        reply = await asyncio.to_thread(_help_for, chat)
    else:
        reply = await asyncio.to_thread(_patient_text, chat, text)
        if reply is None:
            lang = "ky" if tg_lang == "ky" else "ru"
            reply = bt(lang, "hello") + bt(lang, "help_public")
    await _call("sendMessage", {"chat_id": chat, "text": reply, "parse_mode": "HTML"})


def _patient_of_chat(db, chat: int) -> User | None:
    l = db.scalar(select(TelegramLink).where(TelegramLink.chat_id == chat, TelegramLink.kind == "patient"))
    return db.get(User, l.user_id) if l else None


def _help_for(chat: int) -> str:
    with SessionLocal() as db:
        lang = chat_lang(db, chat)
        return bt(lang, "help_patient" if _patient_of_chat(db, chat) else "help_public")


def _set_lang(chat: int, lang: str) -> str:
    with SessionLocal() as db:
        n = 0
        for l in db.scalars(select(TelegramLink).where(TelegramLink.chat_id == chat)):
            l.lang = lang; n += 1
        db.commit()
    return bt(lang, "lang_set") if n else bt(lang, "not_linked") + " " + bt(lang, "help_public")


_BP = re.compile(r"^\s*(\d{2,3})\s*[ /\\\-,]\s*(\d{2,3})(?:\s*[ /\\\-,]\s*(\d{2,3}))?\s*$")
_VAL = re.compile(r"^\s*(сахар|кант|sugar|glucose|вес|салмак|weight)\s*[:=]?\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*$", re.I)


def _patient_text(chat: int, text: str) -> str | None:
    """A linked patient types a value: blood pressure "135 85 72", "сахар 6.4", "вес 82". Saved as a Vital with
    source "telegram", with the same plausibility limits as the app. Anything else: a short help."""
    from .models import Vital
    with SessionLocal() as db:
        p = _patient_of_chat(db, chat)
        if p is None:
            return None
        lang = chat_lang(db, chat)
        m = _BP.match(text)
        if m:
            sy, di = int(m.group(1)), int(m.group(2))
            pu = int(m.group(3)) if m.group(3) else None
            if not (60 <= sy <= 260 and 30 <= di <= 160 and (pu is None or 20 <= pu <= 250)):
                return bt(lang, "bp_bad")
            if sy <= di:
                return bt(lang, "bp_order")
            db.add(Vital(patient_id=p.id, ts=utcnow(), kind="bp", systolic=sy, diastolic=di, pulse=pu, source="telegram"))
            db.commit()
            return bt(lang, "bp_saved", sys=sy, dia=di, pulse=bt(lang, "bp_pulse", pulse=pu) if pu else "")
        m = _VAL.match(text)
        if m:
            word, v = m.group(1).lower(), float(m.group(2).replace(",", "."))
            if word in ("сахар", "кант", "sugar", "glucose"):
                if not 1 <= v <= 40:
                    return bt(lang, "glucose_bad")
                db.add(Vital(patient_id=p.id, ts=utcnow(), kind="glucose", value=v, source="telegram"))
                db.commit()
                return bt(lang, "glucose_saved", v=v)
            if not 20 <= v <= 300:
                return bt(lang, "weight_bad")
            db.add(Vital(patient_id=p.id, ts=utcnow(), kind="weight", value=v, source="telegram"))
            db.commit()
            return bt(lang, "weight_saved", v=v)
        return bt(lang, "not_understood") + bt(lang, "help_patient")


def _week(chat: int) -> str:
    """Seven days in plain words: checks done, verdict words, typed-in blood pressure, pills."""
    from . import main as app_main
    from .models import Vital, Medication, MedDose
    with SessionLocal() as db:
        p = _patient_of_chat(db, chat)
        lang = chat_lang(db, chat)
        if p is None:
            return bt(lang, "week_only_patient") + bt(lang, "help_public")
        now = utcnow()
        since = now - timedelta(days=7)
        ck = app_main.checks_summary(db, p.id, since, now)
        lines = [bt(lang, "week_title", name=html.escape(p.name.split()[0]))]
        if ck["checks"]:
            plan = bt(lang, "week_plan", done=ck["done"], due=ck["due"]) if ck["due"] else ""
            lines.append(bt(lang, "week_checks", n=ck["checks"], plan=plan, reg=ck["regular"], irr=ck["irregular"], nov=ck["no_verdict"]))
        else:
            lines.append(bt(lang, "week_no_checks"))
        vs = app_main.vitals_summary(db, p.id, since, now)
        if vs["bp"]:
            b = vs["bp"]
            lines.append(bt(lang, "week_bp", sm=b["sys_mean"], dm=b["dia_mean"], smin=b["sys_min"], dmin=b["dia_min"], smax=b["sys_max"], dmax=b["dia_max"], n=b["n"]))
        if vs["glucose"]:
            lines.append(bt(lang, "week_glucose", m=vs["glucose"]["mean"], n=vs["glucose"]["n"]))
        if vs["weight"]:
            lines.append(bt(lang, "week_weight", v=vs["weight"]["last"]["value"]))
        meds = app_main.meds_adherence(db, p.id, since, now)
        for m in meds:
            if m["due"]:
                lines.append(bt(lang, "week_med", name=html.escape(m["name"]), taken=m["taken"], due=m["due"]))
        lines.append(bt(lang, "week_footer"))
        return "\n".join(lines)


def _link(chat: int, code: str, name: str, tg_lang: str = "") -> str:
    """Language of the chat: Kyrgyz if the person's Telegram is in Kyrgyz, else Russian; /ky and /ru switch later."""
    lang = "ky" if tg_lang == "ky" else "ru"
    with SessionLocal() as db:
        c = db.get(TelegramCode, code)
        if c is None or utcnow() - c.created_at > CODE_TTL:
            return bt(lang, "link_expired")
        u = db.get(User, c.user_id)
        existing = db.scalar(select(TelegramLink).where(TelegramLink.chat_id == chat, TelegramLink.kind == c.kind,
                                                        TelegramLink.user_id == c.user_id))
        if existing:
            lang = existing.lang or lang
        else:
            db.add(TelegramLink(chat_id=chat, kind=c.kind, user_id=c.user_id, name=name[:200], created_at=utcnow(), lang=lang))
        db.delete(c)
        db.commit()
        broker.publish(u.id if u.role == "doctor" else u.doctor_id, "telegram", {"user_id": u.id})
        if c.kind == "doctor":
            return (f"✅ Готово, {html.escape(u.name)}. Сюда будут приходить тревоги ФП по всем вашим пациентам "
                    f"с ЭКГ и кнопкой «Принять».\n/status — кто сейчас в ФП")
        if c.kind == "patient":
            return bt(lang, "linked_patient", name=html.escape(u.name.split()[0])) + bt(lang, "help_patient")
        return bt(lang, "linked_family", name=html.escape(u.name))


def _unlink(chat: int) -> str:
    with SessionLocal() as db:
        n = db.execute(delete(TelegramLink).where(TelegramLink.chat_id == chat)).rowcount
        db.commit()
    return bt("ru", "unlinked") if n else bt("ru", "not_linked")


def _status(chat: int) -> str:
    """Doctor: who is in AF now (research view). Patient or relative: the last 30-s check in plain words, and whether the
    sensor is connected. AF state words are shown only for study participants (the same rule as in the app)."""
    from . import main as app_main
    with SessionLocal() as db:
        links = list(db.scalars(select(TelegramLink).where(TelegramLink.chat_id == chat)))
        lang = next((l.lang for l in links if l.lang), "ru")
        if not links:
            return bt("ru", "status_not_linked") + bt("ru", "help_public")
        now = utcnow()
        is_doctor = any(l.kind == "doctor" for l in links)
        pats: dict[int, User] = {}
        for l in links:
            if l.kind == "doctor":
                for p in db.scalars(select(User).where(User.doctor_id == l.user_id)):
                    pats[p.id] = p
            elif l.kind in ("patient", "family"):
                u = db.get(User, l.user_id)
                if u and u.role == "patient":
                    pats[u.id] = u
                elif u and u.role == "family":
                    for fl in db.scalars(select(FamilyLink).where(FamilyLink.watcher_id == u.id, FamilyLink.revoked_at.is_(None))):
                        pp = db.get(User, fl.patient_id)
                        if pp:
                            pats[pp.id] = pp
        out = []
        for p in pats.values():
            r = db.scalar(select(Reading).where(Reading.patient_id == p.id).order_by(Reading.ts.desc()).limit(1))
            online = r is not None and now - r.ts <= timedelta(minutes=2)
            research = is_doctor or app_main.patient_mode(db, p) == "research"
            if research:
                if not online:
                    st = "⚪ нет связи" + (f" (с {local(r.ts)})" if r else "")
                elif r.state == STATE_AFIB:
                    st = f"🔴 ФП, {round(r.bpm)} уд/мин"
                elif r.state == STATE_NORMAL:
                    st = f"🟢 норма, {round(r.bpm)} уд/мин"
                else:
                    st = "🟡 накопление данных"
            else:
                last = db.scalar(select(EcgStrip).where(EcgStrip.patient_id == p.id, EcgStrip.reason == "check")
                                 .order_by(EcgStrip.ts.desc()).limit(1))
                if last is not None:
                    import json as _json
                    from . import ecgtools
                    v = ecgtools.check(_json.loads(last.samples), last.fs)["verdict"]
                    st = bt(lang, "status_last", when=local(last.ts), verdict=verdict_words(lang, v))
                else:
                    st = bt(lang, "status_none")
                st += " · " + bt(lang, "status_online" if online else "status_offline")
            out.append((r is None or r.state != STATE_AFIB, p.name, f"{html.escape(p.name)} — {st}"))
        out.sort()
        return bt(lang, "status_title") + "\n" + "\n".join(x[2] for x in out[:40])


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
