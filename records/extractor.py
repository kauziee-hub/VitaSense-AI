"""Reads an uploaded health document (photo or PDF) into structured data.

The model transcribes what is written; it does not diagnose or add advice.
Everything it returns is normalised here so the rest of the app can trust the
shape: lab flags are recomputed from the numbers, prescription timing codes
become clock times, and durations become end dates.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any

SUPPORTED_MIME_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}
MAX_UPLOAD_BYTES = 15 * 1024 * 1024

DOCUMENT_TYPES = ("lab_report", "prescription", "discharge_summary", "imaging_report", "vaccination", "other")
SLOTS = ("morning", "afternoon", "evening", "night")
FOOD_TIMINGS = ("before_food", "after_food", "with_food", "empty_stomach", "any")

# Default clock times for each slot. Before-food doses move 30 minutes earlier.
SLOT_TIMES = {"morning": "08:00", "afternoon": "14:00", "evening": "18:00", "night": "21:00"}

_STRING = {"type": "string"}
_STRINGS = {"type": "array", "items": {"type": "string"}}

EXTRACTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "is_medical_document": {"type": "boolean"},
        "document_type": {"type": "string", "enum": list(DOCUMENT_TYPES)},
        "title": _STRING,
        "document_date": {"type": "string", "description": "YYYY-MM-DD, or empty if not printed"},
        "facility": _STRING,
        "doctor": _STRING,
        "summary": _STRING,
        "lab_results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": _STRING,
                    "value": {"type": "number"},
                    "value_text": _STRING,
                    "unit": _STRING,
                    "ref_low": {"type": "number"},
                    "ref_high": {"type": "number"},
                    "ref_text": _STRING,
                    "flag": {"type": "string", "enum": ["low", "normal", "high", "abnormal", "unknown"]},
                },
                "required": ["name"],
            },
        },
        "conditions": _STRINGS,
        "allergies": _STRINGS,
        "procedures": _STRINGS,
        "medications": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": _STRING,
                    "strength": _STRING,
                    "form": _STRING,
                    "dose": _STRING,
                    "slots": {"type": "array", "items": {"type": "string", "enum": list(SLOTS)}},
                    "as_needed": {"type": "boolean"},
                    "food_timing": {"type": "string", "enum": list(FOOD_TIMINGS)},
                    "duration_days": {"type": "integer"},
                    "instructions": _STRING,
                },
                "required": ["name"],
            },
        },
        "doctor_advice": _STRINGS,
        "follow_up": _STRING,
    },
    "required": ["is_medical_document", "document_type", "summary"],
}

EXTRACTION_PROMPT = """You are reading a person's own medical document so it can be added to their personal health record.

Transcribe what is written. Do not guess values that are not visible, do not add diagnoses that are not written, and do not give treatment advice.

Fill the JSON fields:
- is_medical_document: false if this is not a medical document (then leave other lists empty).
- document_type: lab_report, prescription, discharge_summary, imaging_report, vaccination or other.
- title: short name, e.g. "Complete blood count", "Lipid profile", "Prescription - Dr Rao".
- document_date: the report or visit date as YYYY-MM-DD; empty if not printed.
- facility, doctor: as printed; empty if absent.
- summary: one or two plain-language sentences a non-medical person understands, saying what the document is and what stands out (e.g. "Cholesterol and LDL are above the lab's range; sugar is normal."). No advice.
- lab_results: every test with its value, unit and the reference range printed on the report. Use value for numbers; value_text for non-numeric results like "Negative". flag: low / normal / high from the printed range, abnormal if the report marks it so, unknown if no range.
- conditions: diagnoses or conditions written on the document (e.g. "Type 2 diabetes", "Hypertension").
- allergies: allergies written on the document.
- procedures: surgeries or procedures mentioned.
- medications: each prescribed medicine exactly as written (name, strength like "500 mg", form like tablet/syrup/inhaler, dose like "1 tablet").
  Timing codes used on Indian prescriptions:
  "1-0-1" = morning and night; "1-1-1" = morning, afternoon, night; "0-0-1" = night; "1-0-0" = morning;
  OD = once daily (morning); BD/BID = twice (morning, night); TDS/TID = three times (morning, afternoon, night);
  QID = four times (morning, afternoon, evening, night); HS = at bedtime (night); SOS/PRN = only when needed (as_needed true, no slots);
  AC = before food; PC = after food. "x 5 days" = duration_days 5.
- doctor_advice: non-medicine instructions written by the doctor (diet, rest, tests to repeat).
- follow_up: when to come back, if written.
"""

# Lab names as printed vary a lot; these map common spellings to one key so the
# dashboard and chat can find HbA1c, LDL and so on across reports.
_LAB_ALIASES: dict[str, tuple[str, ...]] = {
    "hba1c": ("hba1c", "glycated haemoglobin", "glycated hemoglobin", "glycosylated", "a1c"),
    "fasting_glucose": ("fasting blood sugar", "fasting plasma glucose", "fbs", "glucose fasting", "fasting glucose"),
    "pp_glucose": ("post prandial", "postprandial", "ppbs", "pp blood sugar"),
    "random_glucose": ("random blood sugar", "rbs", "random glucose"),
    "total_cholesterol": ("total cholesterol", "cholesterol total", "serum cholesterol", "cholesterol, total"),
    "ldl": ("ldl",),
    "hdl": ("hdl",),
    "triglycerides": ("triglyceride",),
    "vldl": ("vldl",),
    "tsh": ("tsh", "thyroid stimulating"),
    "vitamin_d": ("vitamin d", "25-oh", "25 oh", "25-hydroxy"),
    "vitamin_b12": ("vitamin b12", "b12", "cobalamin"),
    "hemoglobin": ("haemoglobin", "hemoglobin", "hb "),
    "creatinine": ("creatinine",),
    "uric_acid": ("uric acid",),
    "platelets": ("platelet",),
    "wbc": ("wbc", "white blood cell", "total leucocyte", "total leukocyte", "tlc"),
    "ferritin": ("ferritin",),
    "crp": ("c-reactive", "crp"),
    "alt": ("alt", "sgpt"),
    "ast": ("ast", "sgot"),
}


def _alias_matches(alias: str, lowered: str) -> bool:
    # Short codes (LDL, AST, TSH...) must be whole words: "ast" is inside "fasting".
    if len(alias) <= 4:
        return re.search(rf"(?<![a-z0-9]){re.escape(alias.strip())}(?![a-z0-9])", lowered) is not None
    return alias in lowered


def canonical_lab_key(name: str) -> str | None:
    lowered = name.lower()
    if "glucose" in lowered or "sugar" in lowered:
        if "fasting" in lowered:
            return "fasting_glucose"
        if "post" in lowered or re.search(r"(?<![a-z])pp(?![a-z])", lowered):
            return "pp_glucose"
        if "random" in lowered:
            return "random_glucose"
    for key, aliases in _LAB_ALIASES.items():
        if any(_alias_matches(alias, lowered) for alias in aliases):
            return key
    return None


def _clean_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _clean_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    seen: set[str] = set()
    out: list[str] = []
    for item in value:
        text = _clean_str(item)
        if text and text.lower() not in seen:
            seen.add(text.lower())
            out.append(text)
    return out


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        match = re.search(r"-?\d+(?:\.\d+)?", value.replace(",", ""))
        if match:
            return float(match.group())
    return None


def _valid_date(value: Any) -> str | None:
    text = _clean_str(value)
    if not text:
        return None
    try:
        parsed = date.fromisoformat(text[:10])
    except ValueError:
        return None
    # A report "from the future" is a misread date.
    if parsed > date.today() + timedelta(days=1) or parsed.year < 1950:
        return None
    return parsed.isoformat()


def _lab_flag(value: float | None, low: float | None, high: float | None, given: str | None) -> str:
    if value is not None and (low is not None or high is not None):
        if low is not None and value < low:
            return "low"
        if high is not None and value > high:
            return "high"
        return "normal"
    if given in {"low", "normal", "high", "abnormal"}:
        return given
    return "unknown"


def _shift(clock: str, minutes: int) -> str:
    hours, mins = (int(part) for part in clock.split(":"))
    total = (hours * 60 + mins + minutes) % (24 * 60)
    return f"{total // 60:02d}:{total % 60:02d}"


def slot_times(slots: list[str], food_timing: str | None) -> list[str]:
    earlier = food_timing in {"before_food", "empty_stomach"}
    times = [_shift(SLOT_TIMES[slot], -30) if earlier else SLOT_TIMES[slot] for slot in SLOTS if slot in slots]
    return times


def normalise_extraction(raw: dict[str, Any], *, today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    document_type = raw.get("document_type") if raw.get("document_type") in DOCUMENT_TYPES else "other"

    labs: list[dict[str, Any]] = []
    for item in raw.get("lab_results") or []:
        if not isinstance(item, dict) or not _clean_str(item.get("name")):
            continue
        value = _number(item.get("value"))
        low = _number(item.get("ref_low"))
        high = _number(item.get("ref_high"))
        name = _clean_str(item.get("name")) or ""
        labs.append(
            {
                "name": name,
                "key": canonical_lab_key(name),
                "value": value,
                "value_text": _clean_str(item.get("value_text")),
                "unit": _clean_str(item.get("unit")),
                "ref_low": low,
                "ref_high": high,
                "ref_text": _clean_str(item.get("ref_text")),
                "flag": _lab_flag(value, low, high, _clean_str(item.get("flag"))),
            }
        )

    document_date = _valid_date(raw.get("document_date"))
    start = date.fromisoformat(document_date) if document_date else today
    medications: list[dict[str, Any]] = []
    for item in raw.get("medications") or []:
        if not isinstance(item, dict) or not _clean_str(item.get("name")):
            continue
        slots = [slot for slot in item.get("slots") or [] if slot in SLOTS]
        as_needed = bool(item.get("as_needed")) or not slots
        food_timing = item.get("food_timing") if item.get("food_timing") in FOOD_TIMINGS else "any"
        duration = item.get("duration_days")
        duration = int(duration) if isinstance(duration, (int, float)) and 0 < duration <= 3650 else None
        medications.append(
            {
                "name": _clean_str(item.get("name")),
                "strength": _clean_str(item.get("strength")),
                "form": _clean_str(item.get("form")),
                "dose": _clean_str(item.get("dose")),
                "slots": slots,
                "times": [] if as_needed else slot_times(slots, food_timing),
                "as_needed": as_needed,
                "food_timing": food_timing,
                "duration_days": duration,
                "start_date": start.isoformat(),
                "end_date": (start + timedelta(days=duration - 1)).isoformat() if duration else None,
                "instructions": _clean_str(item.get("instructions")),
            }
        )

    return {
        "is_medical_document": bool(raw.get("is_medical_document", True)),
        "document_type": document_type,
        "title": _clean_str(raw.get("title")) or document_type.replace("_", " ").capitalize(),
        "document_date": document_date,
        "facility": _clean_str(raw.get("facility")),
        "doctor": _clean_str(raw.get("doctor")),
        "summary": _clean_str(raw.get("summary")) or "",
        "lab_results": labs,
        "conditions": _clean_list(raw.get("conditions")),
        "allergies": _clean_list(raw.get("allergies")),
        "procedures": _clean_list(raw.get("procedures")),
        "medications": medications,
        "doctor_advice": _clean_list(raw.get("doctor_advice")),
        "follow_up": _clean_str(raw.get("follow_up")),
    }


async def extract_document(ai_client: Any, data: bytes, mime_type: str) -> dict[str, Any]:
    raw = await ai_client.generate_json(
        prompt=EXTRACTION_PROMPT,
        files=[(data, mime_type)],
        schema=EXTRACTION_SCHEMA,
        timeout=60.0,
        max_tokens=6000,
    )
    if not isinstance(raw, dict):
        raise ValueError("The document reader returned an unexpected shape")
    return normalise_extraction(raw)
