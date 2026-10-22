"""CHA2DS2-VASc stroke-risk score for AF patients (Lip et al., Chest 2010; ESC AF guidelines).

Also returns CHA2DS2-VA (ESC 2024: same items without female sex). Decision support only — the
anticoagulation decision is the doctor's.
"""
from datetime import datetime

ITEMS = [  # key, points, Russian label
    ("chf", 1, "Сердечная недостаточность / дисфункция ЛЖ"),
    ("hypertension", 1, "Артериальная гипертензия"),
    ("age75", 2, "Возраст ≥ 75 лет"),
    ("diabetes", 1, "Сахарный диабет"),
    ("stroke", 2, "Инсульт / ТИА / тромбоэмболия в анамнезе"),
    ("vascular", 1, "Сосудистое заболевание (ИМ, атеросклероз периферических артерий, бляшка аорты)"),
    ("age65", 1, "Возраст 65–74 года"),
    ("female", 1, "Женский пол"),
]

# Approximate annual stroke/TIA/systemic embolism rate without anticoagulation (Friberg et al., 2012, Swedish AF cohort)
ANNUAL_RISK = {0: 0.2, 1: 0.6, 2: 2.2, 3: 3.2, 4: 4.8, 5: 7.2, 6: 9.7, 7: 11.2, 8: 10.8, 9: 12.2}


def score(birth_year: int | None, sex: str | None, f: dict) -> dict:
    age = datetime.utcnow().year - birth_year if birth_year else None
    flags = {
        "chf": bool(f.get("chf")), "hypertension": bool(f.get("hypertension")), "diabetes": bool(f.get("diabetes")),
        "stroke": bool(f.get("stroke")), "vascular": bool(f.get("vascular")),
        "age75": age is not None and age >= 75, "age65": age is not None and 65 <= age < 75,
        "female": sex == "f",
    }
    pts = {k: (p if flags[k] else 0) for k, p, _ in ITEMS}
    vasc = sum(pts.values())
    va = vasc - pts["female"]
    # level only colours the card (ESC 2024 CHA2DS2-VA bands 0 / 1 / >=2). No treatment advice is generated:
    # that would be clinical decision support, which the software is not registered for. The doctor decides.
    level = "high" if va >= 2 else "moderate" if va == 1 else "low"
    rec = "Шкала справочно. Решение об антикоагулянтах принимает врач по клиническим рекомендациям."
    return {
        "age": age, "sex": sex, "flags": flags, "points": pts,
        "items": [{"key": k, "points": p, "label": lbl, "on": flags[k],
                   "auto": k in ("age75", "age65", "female")} for k, p, lbl in ITEMS],
        "cha2ds2_vasc": vasc, "cha2ds2_va": va, "annual_stroke_risk_pct": ANNUAL_RISK.get(min(vasc, 9)),
        "recommendation": rec, "level": level, "missing_age": age is None,
        "note": "Поддержка решения. Назначение терапии — решение врача с учётом риска кровотечения (HAS-BLED).",
    }
