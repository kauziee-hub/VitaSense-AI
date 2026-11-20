"""Phone data -> the daily fields the forecast and chat read.

The phone sends daily aggregates only (minutes, counts, flags). Calendar event
titles, exact locations and raw sensor streams never leave the device.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

Clock = str  # "HH:MM"


def _clock(value: str | None) -> str | None:
    if not value:
        return None
    hours, _, minutes = value.partition(":")
    if not (hours.isdigit() and minutes[:2].isdigit()):
        return None
    return f"{int(hours) % 24:02d}:{int(minutes[:2]) % 60:02d}:00"


class _Day(BaseModel):
    date: date

    @field_validator("date")
    @classmethod
    def _not_future(cls, value: date) -> date:
        if value > date.today():
            raise ValueError("date is in the future")
        return value


class HealthDay(_Day):
    """One day from Health Connect (Android) or Apple Health (iPhone)."""

    sleep_minutes: float | None = Field(default=None, ge=0, le=24 * 60)
    sleep_start: Clock | None = None
    sleep_end: Clock | None = None
    sleep_awakenings: int | None = Field(default=None, ge=0, le=100)
    steps: int | None = Field(default=None, ge=0, le=200_000)
    distance_m: float | None = Field(default=None, ge=0, le=300_000)
    active_calories: float | None = Field(default=None, ge=0, le=20_000)
    exercise_minutes: float | None = Field(default=None, ge=0, le=24 * 60)
    workout_types: list[str] = Field(default_factory=list, max_length=20)
    heart_rate_avg: float | None = Field(default=None, ge=20, le=250)
    resting_heart_rate: float | None = Field(default=None, ge=20, le=200)
    hrv_ms: float | None = Field(default=None, ge=1, le=400)
    spo2_percent: float | None = Field(default=None, ge=50, le=100)
    respiratory_rate: float | None = Field(default=None, ge=3, le=80)
    body_temperature_c: float | None = Field(default=None, ge=30, le=45)
    weight_kg: float | None = Field(default=None, ge=2, le=400)
    hydration_ml: float | None = Field(default=None, ge=0, le=20_000)
    # Read when a device or app writes them to Health Connect (BP cuff, glucometer, smart scale…).
    systolic_mmhg: float | None = Field(default=None, ge=50, le=260)
    diastolic_mmhg: float | None = Field(default=None, ge=30, le=180)
    blood_glucose_mg_dl: float | None = Field(default=None, ge=20, le=700)
    body_fat_percent: float | None = Field(default=None, ge=2, le=75)
    vo2_max: float | None = Field(default=None, ge=5, le=100)
    nutrition_kcal: float | None = Field(default=None, ge=0, le=15_000)
    floors_climbed: float | None = Field(default=None, ge=0, le=1_000)
    period_day: bool | None = None
    menstrual_flow: Literal["light", "medium", "heavy"] | None = None


class CalendarDay(_Day):
    """Derived on the phone from calendar events; titles are not sent."""

    event_count: int = Field(ge=0, le=200)
    busy_minutes: float = Field(ge=0, le=24 * 60)
    late_events: int = Field(default=0, ge=0, le=100)  # starting at or after 22:00
    early_events: int = Field(default=0, ge=0, le=100)  # starting before 07:00
    travel: bool = False
    exam: bool = False


class ScreenDay(_Day):
    screen_minutes: float = Field(ge=0, le=24 * 60)
    late_night_minutes: float = Field(default=0, ge=0, le=24 * 60)  # 00:00-05:00
    longest_session_minutes: float | None = Field(default=None, ge=0, le=24 * 60)
    unlocks: int | None = Field(default=None, ge=0, le=2000)
    # Longest screen-off stretch in the night ending that morning: a sleep estimate when no
    # wearable is worn. Kept apart from measured sleep so it never overwrites a band's data.
    quiet_start: Clock | None = None
    quiet_end: Clock | None = None
    quiet_minutes: float | None = Field(default=None, ge=0, le=24 * 60)


class DevicePayload(BaseModel):
    source: Literal["health_connect", "apple_health", "calendar", "screen_time", "band"]
    health: list[HealthDay] = Field(default_factory=list, max_length=60)
    calendar: list[CalendarDay] = Field(default_factory=list, max_length=60)
    screen: list[ScreenDay] = Field(default_factory=list, max_length=60)


def _put(target: dict[str, Any], **fields: Any) -> None:
    for key, value in fields.items():
        if value is not None:
            target[key] = value


def workload_from_busy_hours(hours: float) -> str:
    if hours < 1:
        return "Very Low"
    if hours < 3:
        return "Low"
    if hours < 5:
        return "Moderate"
    if hours < 7.5:
        return "High"
    return "Extreme"


def map_device_payload(payload: DevicePayload) -> dict[str, dict[str, dict[str, Any]]]:
    rows: dict[str, dict[str, dict[str, Any]]] = {}

    for day in payload.health:
        fitness = rows.setdefault("daily_fitness_data", {}).setdefault(day.date.isoformat(), {})
        sleep_hours = round(day.sleep_minutes / 60, 2) if day.sleep_minutes else None
        distance_km = round(day.distance_m / 1000, 2) if day.distance_m is not None else None
        _put(
            fitness,
            sleep_hours=sleep_hours,
            sleep_duration_hours=sleep_hours,
            sleep_start_time=_clock(day.sleep_start),
            sleep_end_time=_clock(day.sleep_end),
            sleep_interruptions=day.sleep_awakenings,
            steps=day.steps,
            distance_km=distance_km,
            walking_distance_km=distance_km,
            calories_burned=round(day.active_calories) if day.active_calories is not None else None,
            exercise_minutes=round(day.exercise_minutes) if day.exercise_minutes is not None else None,
            exercise_duration_minutes=round(day.exercise_minutes) if day.exercise_minutes is not None else None,
            workout_type=day.workout_types[0] if day.workout_types else None,
            heart_rate_avg=round(day.heart_rate_avg) if day.heart_rate_avg is not None else None,
            resting_heart_rate=round(day.resting_heart_rate) if day.resting_heart_rate is not None else None,
            hrv_ms=round(day.hrv_ms, 1) if day.hrv_ms is not None else None,
            hrv_score=round(day.hrv_ms, 1) if day.hrv_ms is not None else None,
            spo2_percent=round(day.spo2_percent, 1) if day.spo2_percent is not None else None,
            spo2_level=round(day.spo2_percent, 1) if day.spo2_percent is not None else None,
            respiratory_rate=day.respiratory_rate,
            body_temperature=day.body_temperature_c,
            weight_kg=day.weight_kg,
            body_weight_kg=day.weight_kg,
            water_ml=round(day.hydration_ml) if day.hydration_ml is not None else None,
            water_intake_liters=round(day.hydration_ml / 1000, 2) if day.hydration_ml is not None else None,
            blood_pressure=(
                f"{round(day.systolic_mmhg)}/{round(day.diastolic_mmhg)} mmHg"
                if day.systolic_mmhg is not None and day.diastolic_mmhg is not None
                else None
            ),
            systolic_mmhg=round(day.systolic_mmhg) if day.systolic_mmhg is not None else None,
            diastolic_mmhg=round(day.diastolic_mmhg) if day.diastolic_mmhg is not None else None,
            blood_glucose_mg_dl=round(day.blood_glucose_mg_dl) if day.blood_glucose_mg_dl is not None else None,
            body_fat_percent=round(day.body_fat_percent, 1) if day.body_fat_percent is not None else None,
            vo2_max=round(day.vo2_max, 1) if day.vo2_max is not None else None,
            nutrition_kcal=round(day.nutrition_kcal) if day.nutrition_kcal is not None else None,
            floors_climbed=round(day.floors_climbed) if day.floors_climbed is not None else None,
            period_day=day.period_day,
            menstrual_flow=day.menstrual_flow,
        )

    for day in payload.calendar:
        busy_hours = round(day.busy_minutes / 60, 1)
        calendar = rows.setdefault("daily_calendar_data", {}).setdefault(day.date.isoformat(), {})
        _put(
            calendar,
            event_count=day.event_count,
            busy_hours=busy_hours,
            meetings_workload=workload_from_busy_hours(busy_hours),
            travel_event=day.travel,
            exam_event=day.exam,
            late_events=day.late_events,
            sleep_schedule_disruption=day.late_events > 0 or day.early_events > 0,
        )
        memory = rows.setdefault("daily_user_memory_logs", {}).setdefault(day.date.isoformat(), {})
        _put(memory, workload_intensity=workload_from_busy_hours(busy_hours), travel_today=day.travel or None)

    for day in payload.screen:
        device = rows.setdefault("daily_device_behavior_data", {}).setdefault(day.date.isoformat(), {})
        _put(
            device,
            screen_time_hours=round(day.screen_minutes / 60, 1),
            late_night_usage=day.late_night_minutes >= 20,
            late_night_minutes=round(day.late_night_minutes),
            continuous_usage_minutes=round(day.longest_session_minutes) if day.longest_session_minutes is not None else None,
            unlocks=day.unlocks,
            phone_sleep_hours=round(day.quiet_minutes / 60, 2) if day.quiet_minutes else None,
            phone_sleep_start=_clock(day.quiet_start),
            phone_sleep_end=_clock(day.quiet_end),
        )

    return {table: by_date for table, by_date in rows.items() if any(by_date.values())}
