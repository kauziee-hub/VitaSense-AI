"""Real weather and air around the user, from their location. No key needed.

Open-Meteo gives daily temperature, humidity, rain and UV and hourly US AQI /
PM2.5 for the past two weeks, so connecting location backfills history instead
of starting empty. From those numbers we derive two signals a doctor would ask
about: heat stress, and whether recent weather favours mosquito breeding
(dengue, malaria, chikungunya). These are conditions, not outbreak reports.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

import httpx

logger = logging.getLogger(__name__)

WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT = "VitaSense/1.0 (health assistant prototype)"
PAST_DAYS = 14

_place_cache: dict[tuple[float, float], dict[str, str | None]] = {}


def _mean(values: list[float | None]) -> float | None:
    numbers = [v for v in values if isinstance(v, (int, float))]
    return sum(numbers) / len(numbers) if numbers else None


def aqi_band(aqi: float | None) -> str | None:
    if aqi is None:
        return None
    for limit, label in ((50, "Good"), (100, "Moderate"), (150, "Unhealthy for sensitive groups"), (200, "Unhealthy"), (300, "Very unhealthy")):
        if aqi <= limit:
            return label
    return "Hazardous"


def mosquito_conditions(rain_14d_mm: float | None, mean_temp_c: float | None, humidity: float | None) -> str:
    """Rough breeding-conditions level: standing water after rain + warm + humid."""
    score = 0
    if rain_14d_mm is not None:
        score += 2 if rain_14d_mm >= 50 else 1 if rain_14d_mm >= 15 else 0
    if mean_temp_c is not None and 24 <= mean_temp_c <= 34:
        score += 1
    if humidity is not None and humidity >= 65:
        score += 1
    return "high" if score >= 4 else "moderate" if score >= 2 else "low"


def heat_level(max_temp_c: float | None, humidity: float | None) -> str:
    if max_temp_c is None:
        return "none"
    if max_temp_c >= 40:
        return "heatwave"
    if max_temp_c >= 37 or (max_temp_c >= 34 and (humidity or 0) >= 70):
        return "heat_stress"
    return "none"


async def _place_name(client: httpx.AsyncClient, lat: float, lng: float) -> dict[str, str | None]:
    key = (round(lat, 2), round(lng, 2))
    if key in _place_cache:
        return _place_cache[key]
    place: dict[str, str | None] = {"locality": None, "city": None}
    try:
        response = await client.get(REVERSE_URL, params={"lat": lat, "lon": lng, "format": "jsonv2", "zoom": 14, "addressdetails": 1})
        response.raise_for_status()
        address = response.json().get("address") or {}
        place = {
            "locality": address.get("suburb") or address.get("neighbourhood") or address.get("quarter") or address.get("town") or address.get("village"),
            "city": address.get("city") or address.get("town") or address.get("state_district") or address.get("county"),
        }
    except Exception:
        logger.warning("Reverse geocoding failed")
    _place_cache[key] = place
    return place


async def fetch_environment(lat: float, lng: float, *, http: httpx.AsyncClient | None = None, today: date | None = None) -> dict[str, Any]:
    """Daily environment rows for the past two weeks plus today's alerts."""
    owns = http is None
    client = http or httpx.AsyncClient(timeout=20.0, headers={"User-Agent": USER_AGENT})
    try:
        weather_response = await client.get(
            WEATHER_URL,
            params={
                "latitude": lat,
                "longitude": lng,
                "daily": "temperature_2m_max,temperature_2m_mean,relative_humidity_2m_mean,precipitation_sum,uv_index_max",
                "past_days": PAST_DAYS,
                "forecast_days": 1,
                "timezone": "auto",
            },
        )
        weather_response.raise_for_status()
        air_response = await client.get(
            AIR_URL,
            params={
                "latitude": lat,
                "longitude": lng,
                "hourly": "us_aqi,pm2_5,pm10",
                "past_days": min(PAST_DAYS, 7),
                "forecast_days": 1,
                "timezone": "auto",
            },
        )
        air: dict[str, Any] = {}
        if air_response.status_code == 200:
            air = air_response.json().get("hourly") or {}
        else:
            logger.warning("Air quality fetch failed", extra={"status": air_response.status_code})
        place = await _place_name(client, lat, lng)
    finally:
        if owns:
            await client.aclose()

    daily = weather_response.json().get("daily") or {}
    days: list[str] = daily.get("time") or []
    today_iso = (today or date.today()).isoformat()

    # Hourly air -> per-day worst AQI (what people feel on a bad afternoon) and mean PM2.5.
    air_by_day: dict[str, dict[str, list[float | None]]] = {}
    for index, stamp in enumerate(air.get("time") or []):
        bucket = air_by_day.setdefault(str(stamp)[:10], {"us_aqi": [], "pm2_5": []})
        for key in ("us_aqi", "pm2_5"):
            values = air.get(key) or []
            bucket[key].append(values[index] if index < len(values) else None)

    rows: dict[str, dict[str, Any]] = {}
    location = ", ".join(p for p in (place.get("locality"), place.get("city")) if p) or f"{lat:.3f}, {lng:.3f}"
    for index, day in enumerate(days):
        if day > today_iso:
            continue

        def pick(key: str) -> float | None:
            values = daily.get(key) or []
            value = values[index] if index < len(values) else None
            return float(value) if isinstance(value, (int, float)) else None

        max_temp, mean_temp, humidity = pick("temperature_2m_max"), pick("temperature_2m_mean"), pick("relative_humidity_2m_mean")
        rain = pick("precipitation_sum")
        window = [daily.get("precipitation_sum", [])[i] for i in range(max(0, index - 13), index + 1)]
        rain_14d = sum(v for v in window if isinstance(v, (int, float)))
        aqi_values = [v for v in air_by_day.get(day, {}).get("us_aqi", []) if isinstance(v, (int, float))]
        pm_values = air_by_day.get(day, {}).get("pm2_5", [])
        aqi = max(aqi_values) if aqi_values else None
        heat = heat_level(max_temp, humidity)
        rows[day] = {
            "location": location,
            "temperature_c": round(max_temp, 1) if max_temp is not None else None,
            "temperature_mean_c": round(mean_temp, 1) if mean_temp is not None else None,
            "humidity_percent": round(humidity) if humidity is not None else None,
            "rain_mm": round(rain, 1) if rain is not None else None,
            "rain_14d_mm": round(rain_14d, 1),
            "uv_index": round(pick("uv_index_max") or 0, 1) if pick("uv_index_max") is not None else None,
            "aqi": round(aqi) if aqi is not None else None,
            "aqi_scale": "US AQI" if aqi is not None else None,
            "pm2_5": round(_mean(pm_values), 1) if _mean(pm_values) is not None else None,
            "heatwave_alert": heat == "heatwave",
            "heat_level": heat,
            "mosquito_breeding_conditions": mosquito_conditions(rain_14d, mean_temp, humidity),
        }

    today_row = rows.get(today_iso) or (rows[max(rows)] if rows else {})
    return {
        "place": {**place, "label": location, "lat": round(lat, 4), "lng": round(lng, 4)},
        "rows": rows,
        "today": today_row,
        "alerts": environment_alerts(today_row),
    }


def environment_alerts(row: dict[str, Any]) -> list[dict[str, str]]:
    alerts: list[dict[str, str]] = []
    aqi = row.get("aqi")
    if isinstance(aqi, (int, float)) and aqi > 100:
        alerts.append(
            {
                "type": "air_quality",
                "severity": "high" if aqi > 150 else "medium",
                "title": f"Air quality: {aqi_band(aqi)} (AQI {round(aqi)})",
                "detail": "Throat irritation, cough and tiredness are more likely; limit outdoor exercise near traffic.",
            }
        )
    if row.get("heat_level") in {"heatwave", "heat_stress"}:
        alerts.append(
            {
                "type": "heat",
                "severity": "high" if row["heat_level"] == "heatwave" else "medium",
                "title": f"Heat {'wave' if row['heat_level'] == 'heatwave' else 'stress'}: {row.get('temperature_c')}°C",
                "detail": "Headache, dizziness and nausea can come from heat and dehydration; drink before you feel thirsty.",
            }
        )
    if row.get("mosquito_breeding_conditions") in {"moderate", "high"}:
        alerts.append(
            {
                "type": "mosquito",
                "severity": "high" if row["mosquito_breeding_conditions"] == "high" else "medium",
                "title": "Weather favours mosquitoes",
                "detail": (
                    f"{row.get('rain_14d_mm', 0):.0f} mm of rain in two weeks with warm, humid days. "
                    "Fever with body ache or rash should be checked for dengue."
                ),
            }
        )
    return alerts
