"""What was collected automatically, for the chat prompt and the Connected data screen."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from collect.environment import aqi_band
from collect.outbreaks import cached_notices, notices_for
from collect.risks import assess as assess_risks, top_alerts
from collect.store import CollectedStore

SOURCE_LABELS = {
    "health_connect": "phone health data (Health Connect)",
    "apple_health": "Apple Health",
    "calendar": "calendar",
    "screen_time": "screen time",
    "location": "location (weather and air)",
    "gmail": "food, grocery and pharmacy orders (Gmail)",
    "notifications": "food, grocery and pharmacy order alerts (phone notifications)",
    "band": "fitness band heart rate (Bluetooth)",
    "check_in": "daily check-in",
}


def _latest(by_date: dict[str, dict[str, Any]]) -> tuple[str, dict[str, Any]] | None:
    if not by_date:
        return None
    day = max(by_date)
    return day, by_date[day]


def _when(stamp: str | None) -> str:
    if not stamp:
        return ""
    try:
        moment = datetime.fromisoformat(stamp)
    except ValueError:
        return stamp
    return moment.strftime("%a %d %b %H:%M")


def collected_prompt_lines(store: CollectedStore, user_id: int, *, today: date | None = None) -> list[str]:
    today = today or date.today()
    since = (today - timedelta(days=7)).isoformat()
    lines: list[str] = []

    connections = store.connections(user_id)
    if connections:
        lines.append("Connected sources: " + ", ".join(SOURCE_LABELS.get(s, s) for s in sorted(connections)))

    items = [i for i in store.recent_items(user_id, limit=40) if (i.get("happened_at") or "") >= since]
    for item in items[:12]:
        flags = item["details"].get("flags") or []
        tag = " [" + ", ".join(flags) + "]" if flags else ""
        lines.append(f"{_when(item.get('happened_at'))}: {item['summary']}{tag}")

    days = store.read_days(user_id, since)
    env_days = days.get("daily_environment_data", {})
    env = _latest(env_days)
    if env:
        day, row = env
        parts = []
        if row.get("aqi") is not None:
            parts.append(f"AQI {row['aqi']} ({aqi_band(row['aqi'])}, {row.get('aqi_scale') or 'scale unknown'})")
        if row.get("temperature_c") is not None:
            parts.append(f"max {row['temperature_c']}°C")
        if row.get("humidity_percent") is not None:
            parts.append(f"humidity {row['humidity_percent']}%")
        if row.get("rain_14d_mm") is not None:
            parts.append(f"{row['rain_14d_mm']} mm rain in 14 days")
        if parts:
            lines.append(f"Measured weather at {row.get('location', 'their location')} on {day}: " + ", ".join(parts))
        assessment = assess_risks(days.get("daily_environment_data", {}), today=today)
        elevated = [r for r in assessment["risks"] if r["level"] != "low"]
        if elevated:
            lines.append(
                "Environment risks (measured = today's readings; estimate = weather/season/region, not outbreak reports): "
                + "; ".join(f"{r['title']} {r['level']} [{r['kind']}] ({', '.join(r['why'][:2])})" for r in elevated[:6])
            )
        low = [r["title"] for r in assessment["risks"] if r["level"] == "low"]
        if low:
            lines.append("Low right now: " + ", ".join(low))
        notices = notices_for(cached_notices(), row.get("country"))
        if notices:
            lines.append("WHO outbreak notices for their country: " + "; ".join(f"{n['title']} ({n['date']})" for n in notices[:3]))

    fitness = days.get("daily_fitness_data", {})
    measured_sleep = [(d, r["sleep_hours"]) for d, r in sorted(fitness.items()) if r.get("sleep_hours") is not None]
    if measured_sleep:
        lines.append("Measured sleep (phone): " + ", ".join(f"{d[5:]} {h:.1f}h" for d, h in measured_sleep[-7:]))
    return lines


def collection_status(store: CollectedStore, user_id: int, *, today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    since = (today - timedelta(days=30)).isoformat()
    days = store.read_days(user_id, since)
    env_days = days.get("daily_environment_data", {})
    env = _latest(env_days)
    fitness = _latest({d: r for d, r in days.get("daily_fitness_data", {}).items() if r})
    calendar = _latest(days.get("daily_calendar_data", {}))
    collected_days = sorted({d for by_date in days.values() for d in by_date})
    return {
        "connections": store.connections(user_id),
        "recent_items": store.recent_items(user_id, limit=15),
        "environment": {"date": env[0], **env[1], "alerts": top_alerts(assess_risks(env_days, today=today))} if env else None,
        "latest_health": {"date": fitness[0], **fitness[1]} if fitness else None,
        "latest_calendar": {"date": calendar[0], **calendar[1]} if calendar else None,
        "days_collected_30d": len(collected_days),
        "field_sources": store.field_sources(user_id, since),
    }
