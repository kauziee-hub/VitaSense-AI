"""What the uploaded records add up to, and today's medicine schedule.

Used by the records screen, the chat prompt and the doctor report, so all three
agree on the latest lab values, known conditions and current medicines.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from records.store import RecordsStore

DUE_WINDOW_MINUTES = 60


def _record_date(record: dict[str, Any]) -> str:
    return record.get("document_date") or str(record.get("created_at", ""))[:10]


def build_records_summary(store: RecordsStore, user_id: int) -> dict[str, Any]:
    records = store.list_records(user_id)  # newest first
    latest_labs: dict[str, dict[str, Any]] = {}
    conditions: list[str] = []
    allergies: list[str] = []
    procedures: list[str] = []
    advice: list[str] = []
    seen: dict[str, set[str]] = {"c": set(), "a": set(), "p": set()}

    for record in records:
        extracted = record.get("extracted") or {}
        when = _record_date(record)
        for lab in extracted.get("lab_results") or []:
            key = lab.get("key") or lab.get("name", "").lower()
            if key and key not in latest_labs:
                latest_labs[key] = {**lab, "date": when, "record_id": record["id"]}
        for bucket, target, items in (
            ("c", conditions, extracted.get("conditions")),
            ("a", allergies, extracted.get("allergies")),
            ("p", procedures, extracted.get("procedures")),
        ):
            for item in items or []:
                if item.lower() not in seen[bucket]:
                    seen[bucket].add(item.lower())
                    target.append(item)
        if not advice and extracted.get("doctor_advice"):
            advice = list(extracted["doctor_advice"])

    flagged = [lab for lab in latest_labs.values() if lab.get("flag") in {"low", "high", "abnormal"}]
    return {
        "record_count": len(records),
        "last_record_date": _record_date(records[0]) if records else None,
        "latest_labs": list(latest_labs.values()),
        "flagged_labs": flagged,
        "conditions": conditions,
        "allergies": allergies,
        "procedures": procedures,
        "doctor_advice": advice,
        "medications": store.list_medications(user_id),
    }


def _minutes(clock: str) -> int:
    hours, mins = (int(part) for part in clock.split(":"))
    return hours * 60 + mins


def medication_is_current(med: dict[str, Any], day: date) -> bool:
    if not med.get("active"):
        return False
    if med.get("start_date") and date.fromisoformat(med["start_date"]) > day:
        return False
    if med.get("end_date") and date.fromisoformat(med["end_date"]) < day:
        return False
    return True


def _tracked_from(med: dict[str, Any]) -> datetime:
    """When VitaSense started following this medicine, in local time. Doses due before
    that moment were never the app's to remind about, so they are neither missed nor counted."""
    try:
        added = datetime.fromisoformat(str(med.get("created_at")))
        if added.tzinfo is not None:
            added = added.astimezone().replace(tzinfo=None)
    except ValueError:
        added = datetime.min
    return added


def _at(day: date, clock: str) -> datetime:
    return datetime.combine(day, datetime.min.time()) + timedelta(minutes=_minutes(clock))


def todays_doses(store: RecordsStore, user_id: int, *, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now()
    today = now.date()
    meds = store.list_medications(user_id)
    week_ago = (today - timedelta(days=6)).isoformat()
    logs = {(log["medication_id"], log["dose_date"], log["dose_time"]): log["status"] for log in store.dose_logs(user_id, week_ago)}
    now_minutes = now.hour * 60 + now.minute

    doses: list[dict[str, Any]] = []
    for med in meds:
        if med["as_needed"] or not medication_is_current(med, today):
            continue
        tracked_from = _tracked_from(med)
        for clock in med["times"]:
            status = logs.get((med["id"], today.isoformat(), clock))
            if status is None:
                delta = now_minutes - _minutes(clock)
                if delta > DUE_WINDOW_MINUTES:
                    status = "missed" if _at(today, clock) >= tracked_from else "unlogged"
                elif delta >= -DUE_WINDOW_MINUTES:
                    status = "due"
                else:
                    status = "upcoming"
            doses.append(
                {
                    "medication_id": med["id"],
                    "name": med["name"],
                    "strength": med.get("strength"),
                    "dose": med.get("dose"),
                    "food_timing": med.get("food_timing"),
                    "time": clock,
                    "date": today.isoformat(),
                    "status": status,
                }
            )
    doses.sort(key=lambda d: (d["time"], d["name"]))

    # Adherence over the last 7 days: doses already due since VitaSense started following
    # the medicine, plus any the user logged themselves.
    scheduled = taken = 0
    for offset in range(7):
        day = today - timedelta(days=offset)
        for med in meds:
            if med["as_needed"] or not medication_is_current(med, day):
                continue
            tracked_from = _tracked_from(med)
            for clock in med["times"]:
                logged = logs.get((med["id"], day.isoformat(), clock))
                due = _at(day, clock)
                if logged is None and (due < tracked_from or due > now - timedelta(minutes=DUE_WINDOW_MINUTES)):
                    continue
                scheduled += 1
                if logged == "taken":
                    taken += 1

    return {
        "date": today.isoformat(),
        "doses": doses,
        "as_needed": [m for m in meds if m["as_needed"] and medication_is_current(m, today)],
        "adherence_7d": round(taken / scheduled, 2) if scheduled else None,
    }


def records_prompt_lines(summary: dict[str, Any], *, today: date | None = None) -> list[str]:
    """Compact lines for the chat system prompt."""
    today = today or date.today()
    lines: list[str] = []
    if summary.get("conditions"):
        lines.append("Diagnosed conditions (from their records): " + ", ".join(summary["conditions"]))
    if summary.get("allergies"):
        lines.append("Allergies (from their records): " + ", ".join(summary["allergies"]))
    if summary.get("procedures"):
        lines.append("Past procedures/surgery: " + ", ".join(summary["procedures"]))
    labs = summary.get("latest_labs") or []
    if labs:
        parts = []
        for lab in labs[:14]:
            value = lab.get("value") if lab.get("value") is not None else lab.get("value_text")
            flag = "" if lab.get("flag") in {"normal", "unknown"} else f" ({lab['flag'].upper()})"
            parts.append(f"{lab['name']} {value}{(' ' + lab['unit']) if lab.get('unit') else ''}{flag} on {lab.get('date')}")
        lines.append("Latest lab results: " + "; ".join(parts))
    current = [m for m in summary.get("medications") or [] if medication_is_current(m, today)]
    if current:
        meds = []
        for med in current:
            timing = "as needed" if med["as_needed"] else ", ".join(med["times"])
            started = med.get("start_date")
            since = ""
            if started:
                days = (today - date.fromisoformat(started)).days
                since = f"; started {started}, {days} days ago" if days >= 0 else ""
            meds.append(
                f"{med['name']}{(' ' + med['strength']) if med.get('strength') else ''} ({timing}{since}; prescribed by their doctor)"
            )
        lines.append(
            "Current medicines prescribed by their doctor (do not change or comment on doses; "
            "consider side effects and interactions as possible causes): " + "; ".join(meds)
        )
    if summary.get("doctor_advice"):
        lines.append("Their doctor's advice: " + "; ".join(summary["doctor_advice"][:5]))
    return lines
