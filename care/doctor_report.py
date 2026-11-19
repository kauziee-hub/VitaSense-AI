"""One-page report a user hands to the doctor they are about to see.

Facts (lifestyle numbers, history, medicines, labs, local alerts) come straight
from the data. The AI only writes the reason for the visit, a symptom timeline
from what the user told VitaSense, and questions worth asking; it is told not
to diagnose or suggest medicines. If the AI is unavailable the report is still
built from the facts alone.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any

from care.nearby import normalise_specialty
from records.summary import medication_is_current

logger = logging.getLogger(__name__)

REPORT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "reason_for_visit": {"type": "string"},
        "symptom_timeline": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"when": {"type": "string"}, "detail": {"type": "string"}},
                "required": ["when", "detail"],
            },
        },
        "relevant_context": {"type": "array", "items": {"type": "string"}},
        "questions_for_doctor": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["reason_for_visit", "symptom_timeline", "relevant_context", "questions_for_doctor"],
}

REPORT_PROMPT = """Write the patient-reported part of a one-page summary that a person will hand to a {specialty} at their appointment.

Rules:
- Third person, factual, short. Write as a summary of what the patient reports and what their tracked data shows.
- Do NOT diagnose, do NOT name likely conditions, do NOT suggest medicines, tests or treatment.
- Use only the information below. If something is unknown, leave it out.

Fields:
- reason_for_visit: one or two sentences: the main complaint, since when, how it has changed.
- symptom_timeline: dated or relative entries in order ("3 days ago", "Since 17 Nov"), from what the patient said.
- relevant_context: up to 6 short factual points from the tracked data a doctor would want for THIS complaint (sleep, food, stress, air quality, outbreaks nearby, current medicines, recent abnormal labs). Include numbers.
- questions_for_doctor: 3 to 5 questions the patient could ask about this complaint.

Main concern typed by the patient: {concern}

What the patient told VitaSense (most recent last):
{conversation}

Tracked facts:
{facts}
"""

METRIC_ORDER = ("sleep", "hrv", "hydration", "steps", "screen_time", "aqi")


def _fmt_metric(key: str, metric: dict[str, Any]) -> dict[str, Any] | None:
    value, baseline, unit = metric.get("value"), metric.get("baseline"), metric.get("unit") or ""
    if value is None:
        return None

    def show(number: float | None) -> str | None:
        if number is None:
            return None
        if key == "hydration":
            return f"{number / 1000:.1f} L"
        if key == "steps":
            return f"{round(number):,}"
        if key in {"sleep", "screen_time"}:
            return f"{number:.1f} h"
        return f"{round(number)} {unit}".strip()

    return {"label": metric.get("label") or key, "latest": show(value), "average_30d": show(baseline), "trend": metric.get("trend")}


def _history(profile: dict[str, Any], records: dict[str, Any]) -> dict[str, list[str]]:
    medical = profile.get("user_medical_identity") or {}

    def merge(*sources: Any) -> list[str]:
        out: list[str] = []
        seen: set[str] = set()
        for source in sources:
            for item in source or []:
                text = str(item).strip()
                if text and text.lower() not in seen and not text.lower().startswith("no major history"):
                    seen.add(text.lower())
                    out.append(text)
        return out

    return {
        "conditions": merge(records.get("conditions"), medical.get("chronic_conditions")),
        "allergies": merge(records.get("allergies"), medical.get("allergy_conditions")),
        "past_history": merge(records.get("procedures"), medical.get("major_medical_history")),
        "recurring_patterns": merge(medical.get("recurring_health_patterns")),
    }


def build_report_facts(
    *,
    user_name: str,
    forecast: dict[str, Any],
    profile: dict[str, Any],
    records: dict[str, Any],
    today: date | None = None,
) -> dict[str, Any]:
    today = today or date.today()
    metrics = forecast.get("metrics") or {}
    lifestyle = [m for key in METRIC_ORDER if key in metrics and (m := _fmt_metric(key, metrics[key]))]
    patterns = [
        {"title": item.get("title"), "evidence": item.get("evidence")}
        for item in (forecast.get("reasoning_timeline") or [])[:6]
        if item.get("title")
    ]
    medications = [
        {
            "name": med["name"],
            "strength": med.get("strength"),
            "dose": med.get("dose"),
            "schedule": "As needed" if med.get("as_needed") else ", ".join(med.get("times") or []),
            "since": med.get("start_date"),
        }
        for med in records.get("medications") or []
        if medication_is_current(med, today)
    ]
    labs = sorted(
        records.get("latest_labs") or [],
        key=lambda lab: (lab.get("flag") not in {"low", "high", "abnormal"}, lab.get("name", "")),
    )[:12]
    alerts = [
        {"title": alert.get("title"), "detail": alert.get("detail")}
        for alert in ((forecast.get("live_risk_intelligence") or {}).get("local_alerts") or [])[:4]
    ]
    life = profile.get("user_life_context") or {}
    food = profile.get("user_food_body_relationship") or {}
    return {
        "patient": {
            "name": user_name,
            "life_phase": life.get("life_phase"),
            "lifestyle": life.get("lifestyle_identity"),
            "eating": food.get("eating_behavior"),
        },
        "lifestyle_30d": lifestyle,
        "patterns_30d": patterns,
        "history": _history(profile, records),
        "medications": medications,
        "labs": [
            {
                "name": lab.get("name"),
                "value": lab.get("value") if lab.get("value") is not None else lab.get("value_text"),
                "unit": lab.get("unit"),
                "range": lab.get("ref_text")
                or (
                    f"{lab['ref_low']:g}-{lab['ref_high']:g}"
                    if lab.get("ref_low") is not None and lab.get("ref_high") is not None
                    else None
                ),
                "flag": lab.get("flag"),
                "date": lab.get("date"),
            }
            for lab in labs
        ],
        "local_alerts": alerts,
    }


def _facts_text(facts: dict[str, Any]) -> str:
    lines = []
    for item in facts["lifestyle_30d"]:
        lines.append(f"- {item['label']}: latest {item['latest']}, 30-day average {item['average_30d']}")
    for item in facts["patterns_30d"]:
        lines.append(f"- Pattern: {item['title']} ({item['evidence']})")
    history = facts["history"]
    for label, key in (("Conditions", "conditions"), ("Allergies", "allergies"), ("Past history", "past_history"), ("Recurring", "recurring_patterns")):
        if history[key]:
            lines.append(f"- {label}: {', '.join(history[key])}")
    for med in facts["medications"]:
        lines.append(f"- Current medicine: {med['name']} {med.get('strength') or ''} ({med['schedule']})")
    for lab in facts["labs"]:
        if lab.get("flag") in {"low", "high", "abnormal"}:
            lines.append(f"- Lab: {lab['name']} {lab['value']} {lab.get('unit') or ''} ({lab['flag']}) on {lab.get('date')}")
    for alert in facts["local_alerts"]:
        lines.append(f"- Local: {alert['title']}: {alert['detail']}")
    return "\n".join(lines) or "- No tracked data yet"


def _fallback_narrative(concern: str, user_turns: list[str]) -> dict[str, Any]:
    complaint = concern or (user_turns[-1] if user_turns else "General check-up")
    return {
        "reason_for_visit": f"Patient reports: {complaint}",
        "symptom_timeline": [{"when": "Reported to VitaSense", "detail": turn} for turn in user_turns[-5:]],
        "relevant_context": [],
        "questions_for_doctor": [
            "What could be causing this, and what would rule the serious causes out?",
            "Are any tests needed?",
            "What should make me come back sooner or go to emergency?",
        ],
        "ai_written": False,
    }


async def build_doctor_report(
    *,
    ai_client: Any | None,
    user_name: str,
    specialty: str | None,
    concern: str,
    conversation: list[dict[str, str]],
    forecast: dict[str, Any],
    profile: dict[str, Any],
    records: dict[str, Any],
) -> dict[str, Any]:
    label = normalise_specialty(specialty)
    facts = build_report_facts(user_name=user_name, forecast=forecast, profile=profile, records=records)
    user_turns = [turn["content"] for turn in conversation if turn.get("role") == "user" and turn.get("content")]

    narrative = _fallback_narrative(concern, user_turns)
    generate = getattr(ai_client, "generate_json", None)
    if generate is not None and (concern or user_turns):
        transcript = "\n".join(
            f"{'Patient' if turn['role'] == 'user' else 'VitaSense'}: {turn['content'][:600]}"
            for turn in conversation[-10:]
            if turn.get("content")
        )
        try:
            result = await generate(
                prompt=REPORT_PROMPT.format(
                    specialty=label.lower(),
                    concern=concern or "(not typed; use the conversation)",
                    conversation=transcript or "(no conversation)",
                    facts=_facts_text(facts),
                ),
                schema=REPORT_SCHEMA,
                timeout=40.0,
                max_tokens=1500,
            )
            if isinstance(result, dict) and result.get("reason_for_visit"):
                narrative = {
                    "reason_for_visit": str(result["reason_for_visit"]).strip(),
                    "symptom_timeline": [
                        {"when": str(item.get("when", "")).strip(), "detail": str(item.get("detail", "")).strip()}
                        for item in result.get("symptom_timeline") or []
                        if isinstance(item, dict) and item.get("detail")
                    ][:8],
                    "relevant_context": [str(item).strip() for item in result.get("relevant_context") or [] if str(item).strip()][:6],
                    "questions_for_doctor": [str(item).strip() for item in result.get("questions_for_doctor") or [] if str(item).strip()][:5],
                    "ai_written": True,
                }
        except Exception:
            logger.warning("Doctor report narrative failed; using the facts-only version")

    return {
        "generated_at": datetime.now().isoformat(timespec="minutes"),
        "specialty": label,
        "concern": concern,
        **narrative,
        **facts,
        "data_window_days": 30,
        "disclaimer": (
            "Prepared by VitaSense from the patient's own records, tracked lifestyle data and what they reported. "
            "It is not a diagnosis. Medicines listed were prescribed by the patient's doctors."
        ),
    }
