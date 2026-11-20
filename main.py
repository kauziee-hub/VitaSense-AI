import logging
import os
import uuid
import asyncio

import httpx
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from care.doctor_report import build_doctor_report
from care.nearby import find_nearby
from chat.orchestrator import OrchestratorDependencies, stream_chat_sse
from collect.device import DevicePayload, map_device_payload
from collect.email_orders import (
    EmailMessage,
    classify_emails,
    fetch_gmail_attachment,
    fetch_gmail_messages,
    order_rows,
    sender_category,
)
from collect.environment import fetch_environment
from collect.factors import Ctx as FactorCtx, build_factors, connected_sources, days_by_date
from collect.outbreaks import fetch_notices, notices_for
from collect.risks import assess as assess_risks
from collect.store import get_collected_store
from collect.summary import collection_status
from db.demo_seed_data import DEMO_USER_IDS, demo_chat_history
from db.daily_log_store import build_automatic_daily_payloads, fetch_daily_log, upsert_daily_log_tables
from db.setup_context_store import upsert_setup_context_tables
from db.supabase_client import database_marked_unreachable, get_supabase, is_connection_error, mark_unreachable
from db.user_context_loader import (
    load_recent_ai_health_insights,
    load_recent_chatbot_history,
    load_recent_daily_data,
    load_user_health_context,
)
from gemini_client import GeminiClient
from grok_client import GrokClient
from locality.intelligence import build_locality_health_intelligence
from logging_config import configure_logging
from records.extractor import MAX_UPLOAD_BYTES, SUPPORTED_MIME_TYPES, extract_document
from records.store import get_records_store
from records.summary import build_records_summary, todays_doses
from state.conversation_store import conversation_store
from wellness.forecast import build_wellness_forecast

load_dotenv()
configure_logging()
logger = logging.getLogger(__name__)


def _cors_allow_origins() -> list[str]:
    """Browser origins allowed to call this API. Extend via CORS_ORIGINS (comma-separated)."""
    defaults = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:3002",
        "http://127.0.0.1:3002",
        "http://localhost:3020",
        "http://127.0.0.1:3020",
        # Expo web dev server
        "http://localhost:8081",
        "http://127.0.0.1:8081",
        "http://localhost:19006",
        "http://127.0.0.1:19006",
    ]
    extra = os.environ.get("CORS_ORIGINS", "")
    merged = [*defaults]
    for part in extra.split(","):
        origin = part.strip()
        if origin and origin not in merged:
            merged.append(origin)
    return merged

HISTORY_QUERY_TIMEOUT_SECONDS = 10.0
HEALTH_DB_TIMEOUT_SECONDS = 4.0


def _build_ai_client() -> tuple[Any | None, str | None]:
    """Gemini is preferred; Grok stays available as a fallback provider."""
    if os.environ.get("GEMINI_API_KEY"):
        return GeminiClient(), "gemini"
    if os.environ.get("GROK_API_KEY"):
        return GrokClient(), "grok"
    return None, None


_MISSING = object()


def _ai_client(app: FastAPI) -> Any | None:
    """The chat model client. Normally created at startup; serverless hosts (e.g. Vercel) may skip
    the startup hook, so it is built on first use instead."""
    client = getattr(app.state, "grok_client", _MISSING)
    if client is _MISSING:
        try:
            client, provider = _build_ai_client()
        except Exception:
            logger.error("Chat model client could not be created; chat is disabled")
            client, provider = None, None
        app.state.grok_client = client
        app.state.ai_provider = provider
    return client


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start the chat model if a key is set. A failing AI provider never stops the API:
    forecast, logs and maps keep working and chat reports the problem per request."""
    ai_client: Any | None = None
    app.state.grok_client = None
    app.state.ai_provider = None
    try:
        ai_client, provider = _build_ai_client()
    except Exception:
        logger.error("Chat model client could not be created; chat is disabled")
        provider = None
    if ai_client is None:
        logger.warning("No GEMINI_API_KEY or GROK_API_KEY set; chat is disabled until you add one to .env")
    else:
        try:
            models = await ai_client.verify_models()
            logger.info("Chat model verified", extra={"provider": provider, "model_count": len(models)})
        except Exception:
            logger.warning("Chat model verification failed; keeping client so chat can recover", extra={"provider": provider})
        app.state.grok_client = ai_client
        app.state.ai_provider = provider
    try:
        yield
    finally:
        if ai_client is not None:
            await ai_client.close()


app = FastAPI(
    title="VitalIQ Health Chatbot",
    version="2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_allow_origins(),
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

EnergyLevel = Literal["Very Low", "Low", "Moderate", "Good", "High"]
MoodToday = Literal["Very Sad", "Sad", "Neutral", "Happy", "Very Happy", "Anxious", "Stressed", "Exhausted"]
WorkloadIntensity = Literal["Very Low", "Low", "Moderate", "High", "Extreme"]
RiskLevel = Literal["Low", "Medium", "High", "Critical"]
LifePhase = Literal["Student Life", "Early Career", "High-Pressure Work Life", "Transition Phase", "Family-Focused Life", "Irregular Lifestyle"]
SocialEnvironment = Literal["Family", "Friends/Roommates", "Mostly Alone", "Hostel Community", "Coworkers/Classmates", "Mixed"]
LifeStructureType = Literal["Highly Structured", "Moderately Structured", "Unpredictable", "Chaotic"]
LifestyleIdentity = Literal["Health Conscious", "Balanced", "Stress-Driven", "Highly Busy", "Physically Active", "Mentally Exhausted", "Irregular Lifestyle"]
PreferredEnvironment = Literal["Cold Climate", "Warm Climate", "Dry Climate", "Nature/Outdoors", "Indoor Controlled Environment", "No Specific Preference"]
EatingBehavior = Literal["Disciplined", "Emotional Eating", "Irregular Eating", "Convenience-Based", "Late-Night Eating", "Stress-Based Eating"]
BodyAwarenessLevel = Literal["Very Aware", "Aware", "Moderate", "Low Awareness"]
StressResponsePattern = Literal["Sleep", "Appetite", "Energy Levels", "Mood", "Focus", "Physical Symptoms", "Everything"]
RecoveryPreference = Literal["Rest", "Talking to Someone", "Isolation", "Exercise", "Entertainment", "Sleep", "Food", "Nature/Travel"]
LonelinessLevel = Literal["Very Low", "Low", "Moderate", "High", "Very High"]
BurnoutRisk = Literal["Low", "Medium", "High", "Critical"]
InteractionFrequency = Literal["Daily", "Few times a week", "Weekly", "Rarely", "Almost never"]


class ChatRequest(BaseModel):
    user_id: int = Field(gt=0)
    message: str = Field(min_length=1)
    session_id: str | None = Field(default=None, min_length=1)

    @field_validator("message")
    @classmethod
    def message_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Message cannot be empty")
        return value


class HistoryResponse(BaseModel):
    history: list[dict[str, Any]]


BiologicalSex = Literal["male", "female"]


class UserSummary(BaseModel):
    id: int
    user_code: str | None = None
    name: str
    # Chooses the male or female body render; also context for the AI (e.g. period, pregnancy causes).
    biological_sex: BiologicalSex | None = None


class UpdateUserRequest(BaseModel):
    biological_sex: BiologicalSex | None = None


class UsersResponse(BaseModel):
    users: list[UserSummary]


class CreateUserRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    user_code: str | None = Field(default=None, min_length=1, max_length=80)
    biological_sex: BiologicalSex | None = None

    @field_validator("name", "user_code")
    @classmethod
    def clean_user_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.strip().split())
        if not normalized:
            raise ValueError("Value cannot be empty")
        return normalized


class DailyManualInput(BaseModel):
    breakfast_log: str | None = Field(default=None, max_length=500)
    lunch_log: str | None = Field(default=None, max_length=500)
    dinner_log: str | None = Field(default=None, max_length=500)
    snacks_beverages_log: str | None = Field(default=None, max_length=500)
    ate_from_outside: bool | None = None
    processed_food_consumed: bool | None = None
    unusual_food_exposure: bool | None = None
    unusual_exposure_notes: str | None = Field(default=None, max_length=1000)
    energy_level: EnergyLevel | None = None
    mood_today: MoodToday | None = None
    overall_mental_feeling: MoodToday | None = None
    emotional_physical_impact: bool | None = None
    physical_discomfort_notes: str | None = Field(default=None, max_length=1000)
    unusual_body_observation: str | None = Field(default=None, max_length=1000)
    daily_events: list[str] = Field(default_factory=list, max_length=20)
    workload_intensity: WorkloadIntensity | None = None
    crowded_place_exposure: bool | None = None
    travel_today: bool | None = None
    emotional_event_notes: str | None = Field(default=None, max_length=1000)
    chatbot_symptoms_reported: list[str] = Field(default_factory=list, max_length=20)
    doctor_consulted_today: bool | None = None
    medical_visit_reason: str | None = Field(default=None, max_length=1000)

    @field_validator("daily_events", "chatbot_symptoms_reported")
    @classmethod
    def clean_text_array(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        for item in value:
            normalized = item.strip()
            if normalized:
                cleaned.append(normalized[:120])
        return cleaned


class DailyLogRequest(BaseModel):
    log_date: date
    manual: DailyManualInput = Field(default_factory=DailyManualInput)


class DailyLogResponse(BaseModel):
    user_id: int
    log_date: str
    saved_tables: list[str] = Field(default_factory=list)
    tables: dict[str, dict[str, Any]]


class SetupContextRequest(BaseModel):
    life_phase: LifePhase | None = None
    social_environment: SocialEnvironment | None = None
    life_structure_type: LifeStructureType | None = None
    lifestyle_identity: LifestyleIdentity | None = None
    preferred_environment: PreferredEnvironment | None = None
    perceived_health_triggers: list[str] = Field(default_factory=list, max_length=30)
    chronic_conditions: list[str] = Field(default_factory=list, max_length=30)
    recurring_health_patterns: list[str] = Field(default_factory=list, max_length=30)
    allergy_conditions: list[str] = Field(default_factory=list, max_length=30)
    major_medical_history: list[str] = Field(default_factory=list, max_length=30)
    personal_health_note: str | None = Field(default=None, max_length=3000)
    eating_behavior: EatingBehavior | None = None
    unhealthy_eating_triggers: list[str] = Field(default_factory=list, max_length=30)
    body_awareness_level: BodyAwarenessLevel | None = None
    emotional_health_impact: bool | None = None
    emotional_tracking_enabled: bool = True
    emotional_pressure_sources: list[str] = Field(default_factory=list, max_length=30)
    stress_response_pattern: StressResponsePattern | None = None
    recovery_preference: RecoveryPreference | None = None
    loneliness_level: LonelinessLevel | None = None
    depression_signals: list[str] = Field(default_factory=list, max_length=30)
    anxiety_triggers: list[str] = Field(default_factory=list, max_length=30)
    burnout_risk: BurnoutRisk | None = None
    emotional_support_system: str | None = Field(default=None, max_length=1000)
    coping_mechanisms: list[str] = Field(default_factory=list, max_length=30)
    emotional_stability_score: int | None = Field(default=None, ge=0, le=100)
    social_interaction_frequency: InteractionFrequency | None = None
    self_isolation_pattern: str | None = Field(default=None, max_length=1000)
    emotional_notes: str | None = Field(default=None, max_length=2000)

    @field_validator(
        "perceived_health_triggers",
        "chronic_conditions",
        "recurring_health_patterns",
        "allergy_conditions",
        "major_medical_history",
        "unhealthy_eating_triggers",
        "emotional_pressure_sources",
        "depression_signals",
        "anxiety_triggers",
        "coping_mechanisms",
    )
    @classmethod
    def clean_setup_text_array(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        for item in value:
            normalized = item.strip()
            if normalized:
                cleaned.append(normalized[:160])
        return cleaned


class SetupContextResponse(BaseModel):
    user_id: int
    saved_tables: list[str]


class SetupContextLoadResponse(BaseModel):
    user_id: int
    tables: dict[str, dict[str, Any]]


CORE_LOCAL_USERS: tuple[dict[str, str | int], ...] = (
    {"id": 1, "user_code": "kausik", "name": "Kausik"},
    {"id": 2, "user_code": "rithik", "name": "Rithik"},
    {"id": 3, "user_code": "abhishek", "name": "Abhishek"},
)

CORE_LOCAL_USER_NAMES = {str(user["name"]).lower() for user in CORE_LOCAL_USERS}


class WellnessForecastResponse(BaseModel):
    user_id: int
    date: str
    analysis_window_days: int = 30
    headline: str
    summary: str
    readiness_score: int
    energy: dict[str, Any]
    recovery: dict[str, Any]
    hero_prediction: dict[str, Any] = Field(default_factory=dict)
    reasoning_timeline: list[dict[str, Any]] = Field(default_factory=list)
    future_forecast: list[dict[str, Any]] = Field(default_factory=list)
    body_systems: list[dict[str, Any]] = Field(default_factory=list)
    behavioral_detections: list[dict[str, Any]] = Field(default_factory=list)
    health_strategist: list[dict[str, Any]] = Field(default_factory=list)
    live_risk_intelligence: dict[str, Any] = Field(default_factory=dict)
    engine_scores: dict[str, int] = Field(default_factory=dict)
    patterns: list[dict[str, str]]
    suggested_actions: list[dict[str, str]]
    environmental_alerts: list[dict[str, str]]
    metrics: dict[str, dict[str, Any]]
    source_tables: list[str]
    # "demo" when synthetic seed data fills the signals (built-in demo users), "live" otherwise.
    data_mode: Literal["live", "demo"] = "live"


class LocalityHealthIntelligenceResponse(BaseModel):
    user_id: int
    generated_on: str
    city: str
    locality: str
    radius_km: float
    scan_status: dict[str, Any]
    layers: list[dict[str, Any]]
    hotspots: list[dict[str, Any]]
    community_symptom_clusters: list[dict[str, Any]]
    risk_cards: list[dict[str, Any]]
    predictive_lifestyle_risks: list[dict[str, Any]]
    source_architecture: list[dict[str, Any]]
    mock_intelligence_feeds: list[dict[str, Any]]
    correlation_explanation: str


async def _database_reachable() -> bool:
    if database_marked_unreachable():
        return False
    try:
        supabase = get_supabase()
        await asyncio.wait_for(
            asyncio.to_thread(lambda: supabase.table("users").select("id").limit(1).execute()),
            timeout=HEALTH_DB_TIMEOUT_SECONDS,
        )
        return True
    except Exception as exc:
        if isinstance(exc, asyncio.TimeoutError) or is_connection_error(exc):
            mark_unreachable()
        return False


@app.get("/health")
async def health(request: Request) -> dict[str, str | bool | None]:
    ai_client = _ai_client(request.app)
    ai_ok, database_ok = await asyncio.gather(
        ai_client.health_check() if ai_client is not None else asyncio.sleep(0, result=False),
        _database_reachable(),
    )

    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "ai": ai_ok,
        "ai_provider": getattr(request.app.state, "ai_provider", None),
        "database": database_ok,
    }


def _get_dependencies(request: Request) -> OrchestratorDependencies:
    grok_client = _ai_client(request.app)
    if grok_client is None:
        raise HTTPException(status_code=503, detail="Chat model is not configured")

    return OrchestratorDependencies(
        grok_client=grok_client,
        supabase_factory=get_supabase,
        store=conversation_store,
    )


def _user_code_from_name(name: str) -> str:
    normalized = "".join(char.lower() if char.isalnum() else "-" for char in name.strip())
    parts = [part for part in normalized.split("-") if part]
    base = "-".join(parts) or "user"
    suffix = uuid.uuid4().hex[:8]
    return f"{base}-{suffix}"[:80]


def _core_users_missing(rows: Any) -> bool:
    if not isinstance(rows, list):
        return True
    names = {
        str(row.get("name", "")).strip().lower()
        for row in rows
        if isinstance(row, dict)
    }
    return not CORE_LOCAL_USER_NAMES.issubset(names)


async def _fetch_user_rows(supabase: Any) -> list[dict[str, Any]]:
    async def query(columns: str) -> Any:
        return await asyncio.wait_for(
            asyncio.to_thread(lambda: supabase.table("users").select(columns).order("id", desc=False).execute()),
            timeout=HISTORY_QUERY_TIMEOUT_SECONDS,
        )

    try:
        response = await query("id,user_code,name,biological_sex")
    except asyncio.TimeoutError:
        raise
    except Exception:
        # Database without the biological_sex column (db/users_biological_sex.sql not applied yet).
        response = await query("id,user_code,name")
    rows = getattr(response, "data", None)
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


async def _ensure_core_users(supabase: Any) -> None:
    await asyncio.wait_for(
        asyncio.to_thread(
            lambda: (
                supabase.table("users")
                .upsert(list(CORE_LOCAL_USERS), on_conflict="id")
                .execute()
            )
        ),
        timeout=HISTORY_QUERY_TIMEOUT_SECONDS,
    )


@app.get("/api/v1/users", response_model=UsersResponse)
async def list_users() -> UsersResponse:
    try:
        if database_marked_unreachable():
            raise RuntimeError("database unreachable")
        supabase = get_supabase()
        rows = await _fetch_user_rows(supabase)
        if _core_users_missing(rows):
            await _ensure_core_users(supabase)
            rows = await _fetch_user_rows(supabase)
    except Exception:
        # Hosted database offline: demo profiles plus people created on this server.
        logger.warning("Users query failed; serving local users")
        rows = [*CORE_LOCAL_USERS, *get_collected_store().list_users()]

    users = [
        UserSummary(
            id=int(row["id"]),
            user_code=row.get("user_code"),
            name=str(row.get("name") or f"User {row['id']}"),
            biological_sex=row.get("biological_sex") if row.get("biological_sex") in ("male", "female") else None,
        )
        for row in rows
        if "id" in row
    ]
    return UsersResponse(users=users)


@app.put("/api/v1/users/{user_id}", response_model=UserSummary)
async def update_user(user_id: int, payload: UpdateUserRequest) -> UserSummary:
    if user_id <= 0:
        raise HTTPException(status_code=422, detail="user_id must be a positive integer")
    changes = payload.model_dump(exclude_unset=True)
    try:
        if database_marked_unreachable():
            raise RuntimeError("database unreachable")
        supabase = get_supabase()
        response = await asyncio.wait_for(
            asyncio.to_thread(lambda: supabase.table("users").update(changes).eq("id", user_id).execute()),
            timeout=HISTORY_QUERY_TIMEOUT_SECONDS,
        )
        rows = getattr(response, "data", None)
        if isinstance(rows, list) and rows:
            return UserSummary(**{k: rows[0].get(k) for k in ("id", "user_code", "name", "biological_sex")})
    except Exception:
        logger.warning("User update failed on the hosted database; trying local users")
    local = await asyncio.to_thread(get_collected_store().update_user, user_id, changes)
    if local is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return UserSummary(**local)


@app.post("/api/v1/users", response_model=UserSummary)
async def create_user(payload: CreateUserRequest) -> UserSummary:
    user_code = payload.user_code or _user_code_from_name(payload.name)
    insert_payload: dict[str, Any] = {
        "name": payload.name,
        "user_code": user_code,
    }
    if payload.biological_sex:
        insert_payload["biological_sex"] = payload.biological_sex

    try:
        if database_marked_unreachable():
            raise RuntimeError("database unreachable")
        supabase = get_supabase()
        response = await asyncio.wait_for(
            asyncio.to_thread(
                lambda: (
                    supabase.table("users")
                    .insert(insert_payload)
                    .execute()
                )
            ),
            timeout=HISTORY_QUERY_TIMEOUT_SECONDS,
        )
    except Exception:
        logger.warning("User create failed on the hosted database; creating a local user")
        local = await asyncio.to_thread(get_collected_store().create_user, payload.name, user_code, payload.biological_sex)
        return UserSummary(**local)

    rows = getattr(response, "data", None)
    if isinstance(rows, list) and rows and isinstance(rows[0], dict):
        return UserSummary(**rows[0])
    if isinstance(rows, dict):
        return UserSummary(**rows)
    raise HTTPException(status_code=500, detail="User create returned no row")


def _daily_log_table_payloads(user_id: int, payload: DailyLogRequest) -> dict[str, dict[str, Any]]:
    # Demo profiles keep their generated sensor days. Real users only get what they entered;
    # sleep, steps, air and screen time come from connected sources, never from a formula.
    table_payloads = (
        build_automatic_daily_payloads(user_id=user_id, log_date=payload.log_date) if user_id in DEMO_USER_IDS else {}
    )
    manual = payload.manual.model_dump()
    ai_fields = _daily_ai_fields(payload.manual)
    table_payloads["daily_user_memory_logs"] = {
        **manual,
        "breakfast": manual.get("breakfast_log"),
        "lunch": manual.get("lunch_log"),
        "dinner": manual.get("dinner_log"),
        "snacks": manual.get("snacks_beverages_log"),
        "events": manual.get("daily_events", []),
        "chatbot_symptoms": manual.get("chatbot_symptoms_reported", []),
        "doctor_visit": manual.get("doctor_consulted_today"),
        **ai_fields,
    }
    return table_payloads


def _daily_ai_fields(manual: DailyManualInput) -> dict[str, Any]:
    symptoms = manual.chatbot_symptoms_reported
    context = [manual.physical_discomfort_notes, manual.unusual_body_observation, manual.emotional_event_notes]
    joined = " ".join(item.lower() for item in [*symptoms, *[value or "" for value in context]])
    risk_level: RiskLevel = "Medium" if any(word in joined for word in ("pain", "fever", "dizzy", "breath")) else "Low"
    if any(word in joined for word in ("severe", "chest", "faint", "emergency")):
        risk_level = "High"

    possible_causes = ["hydration, sleep, workload, food exposure, and environmental patterns"]
    if manual.processed_food_consumed or manual.ate_from_outside or manual.unusual_food_exposure:
        possible_causes.append("recent food exposure or meal timing")
    if manual.workload_intensity in {"High", "Extreme"} or manual.emotional_physical_impact:
        possible_causes.append("stress load and emotional-body response")

    return {
        "chatbot_possible_causes": possible_causes,
        "chatbot_health_assistant_response": (
            "VitaSense logged these signals for pattern tracking. If symptoms worsen or feel concerning, consult a qualified clinician."
        ),
        "chatbot_recommended_actions": [
            "Monitor changes through the day",
            "Prioritize hydration and rest",
            "Avoid intense activity if discomfort increases",
        ],
        "chatbot_risk_level": risk_level,
        "chatbot_followup_questions": [
            "When did this start?",
            "Is it improving, worsening, or staying the same?",
        ],
        "chatbot_session_summary": "Daily log captured with manual user context and generated assistant metadata.",
    }


def _setup_context_payloads(payload: SetupContextRequest) -> dict[str, dict[str, Any]]:
    personal_summary = _personal_context_summary(payload)
    ai_patterns = _ai_behavioral_patterns(payload)
    ai_risks = _ai_risk_factors(payload)
    return {
        "user_life_context": {
            "life_phase": payload.life_phase,
            "social_environment": payload.social_environment,
            "life_structure_type": payload.life_structure_type,
            "lifestyle_identity": payload.lifestyle_identity,
            "preferred_environment": payload.preferred_environment,
            "perceived_health_triggers": payload.perceived_health_triggers,
        },
        "user_medical_identity": {
            "chronic_conditions": payload.chronic_conditions,
            "recurring_health_patterns": payload.recurring_health_patterns,
            "allergy_conditions": payload.allergy_conditions,
            "major_medical_history": payload.major_medical_history,
            "personal_health_note": payload.personal_health_note,
        },
        "user_food_body_relationship": {
            "eating_behavior": payload.eating_behavior,
            "unhealthy_eating_triggers": payload.unhealthy_eating_triggers,
            "body_awareness_level": payload.body_awareness_level,
            "emotional_health_impact": payload.emotional_health_impact,
        },
        "user_emotional_wellness": {
            "emotional_tracking_enabled": payload.emotional_tracking_enabled,
            "emotional_pressure_sources": payload.emotional_pressure_sources,
            "stress_response_pattern": payload.stress_response_pattern,
            "recovery_preference": payload.recovery_preference,
            "loneliness_level": payload.loneliness_level,
            "depression_signals": payload.depression_signals,
            "anxiety_triggers": payload.anxiety_triggers,
            "burnout_risk": payload.burnout_risk,
            "emotional_support_system": payload.emotional_support_system,
            "coping_mechanisms": payload.coping_mechanisms,
            "emotional_stability_score": payload.emotional_stability_score,
            "social_interaction_frequency": payload.social_interaction_frequency,
            "self_isolation_pattern": payload.self_isolation_pattern,
            "emotional_notes": payload.emotional_notes,
        },
        "user_personal_context": {
            "personal_context_summary": personal_summary,
        },
        "ai_user_health_profile": {
            "ai_health_summary": f"{personal_summary} VitaSense should compare daily signals against this baseline.",
            "ai_behavioral_patterns": ai_patterns,
            "ai_risk_factors": ai_risks,
            "ai_lifestyle_assessment": _ai_lifestyle_assessment(payload),
            "ai_last_updated": datetime.now(timezone.utc).isoformat(),
        },
    }


def _personal_context_summary(payload: SetupContextRequest) -> str:
    parts = [
        payload.life_phase,
        payload.lifestyle_identity,
        payload.life_structure_type,
        payload.preferred_environment,
    ]
    summary = ", ".join(part for part in parts if part)
    if payload.personal_health_note:
        summary = f"{summary}. {payload.personal_health_note}" if summary else payload.personal_health_note
    return summary or "User setup context is available for personalization."


def _ai_behavioral_patterns(payload: SetupContextRequest) -> list[str]:
    patterns: list[str] = []
    if payload.perceived_health_triggers:
        patterns.append("Health often changes around: " + ", ".join(payload.perceived_health_triggers[:4]))
    if payload.unhealthy_eating_triggers:
        patterns.append("Eating behavior may shift around: " + ", ".join(payload.unhealthy_eating_triggers[:4]))
    if payload.emotional_pressure_sources:
        patterns.append("Emotional pressure sources include: " + ", ".join(payload.emotional_pressure_sources[:4]))
    if payload.anxiety_triggers:
        patterns.append("Anxiety may be triggered by: " + ", ".join(payload.anxiety_triggers[:4]))
    if payload.coping_mechanisms:
        patterns.append("Helpful coping mechanisms include: " + ", ".join(payload.coping_mechanisms[:4]))
    return patterns or ["Initial behavioral baseline captured during onboarding."]


def _ai_risk_factors(payload: SetupContextRequest) -> list[str]:
    risks = [*payload.chronic_conditions, *payload.allergy_conditions, *payload.recurring_health_patterns]
    if payload.loneliness_level in {"High", "Very High"}:
        risks.append("high loneliness level")
    if payload.burnout_risk in {"High", "Critical"}:
        risks.append(f"{payload.burnout_risk.lower()} burnout risk")
    risks.extend(payload.depression_signals[:3])
    return risks[:8] or ["No explicit long-term risk factors reported during onboarding."]


def _ai_lifestyle_assessment(payload: SetupContextRequest) -> str:
    if payload.lifestyle_identity or payload.life_structure_type:
        return f"{payload.lifestyle_identity or 'Current lifestyle'} with {payload.life_structure_type or 'unknown structure'} routine."
    return "Lifestyle assessment will improve as daily logs accumulate."


@app.post("/api/v1/chat")
async def chat(request: Request, chat_request: ChatRequest) -> StreamingResponse:
    session_id = chat_request.session_id or str(uuid.uuid4())
    dependencies = _get_dependencies(request)

    return StreamingResponse(
        stream_chat_sse(
            chat_request.user_id,
            session_id,
            chat_request.message.strip(),
            dependencies=dependencies,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/v1/user/{user_id}/history", response_model=HistoryResponse)
async def get_history(
    user_id: int,
    limit: int = Query(default=20, ge=1, le=100),
) -> HistoryResponse:
    if user_id <= 0:
        raise HTTPException(status_code=422, detail="user_id must be a positive integer")

    try:
        supabase = get_supabase()
    except Exception:
        logger.error("Supabase client initialization failed for history", extra={"user_id": user_id})
        raise HTTPException(status_code=503, detail="History storage is unavailable") from None

    try:
        response = await asyncio.wait_for(
            asyncio.to_thread(
                lambda: (
                    supabase.table("chatbot_conversation_history")
                    .select("*")
                    .eq("user_id", user_id)
                    .order("created_at", desc=True)
                    .limit(limit)
                    .execute()
                )
            ),
            timeout=HISTORY_QUERY_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.error("History query timed out", extra={"user_id": user_id})
        raise HTTPException(status_code=504, detail="History query timed out") from None
    except Exception:
        logger.error("History query failed", extra={"user_id": user_id})
        raise HTTPException(status_code=500, detail="History query failed") from None

    data = getattr(response, "data", None)
    history = data if isinstance(data, list) else []
    if not history and user_id in DEMO_USER_IDS:
        history = demo_chat_history(user_id, limit)
    return HistoryResponse(history=history)


@app.get("/api/v1/user/{user_id}/daily-log", response_model=DailyLogResponse)
async def get_daily_log(
    user_id: int,
    log_date: date = Query(...),
) -> DailyLogResponse:
    if user_id <= 0:
        raise HTTPException(status_code=422, detail="user_id must be a positive integer")

    try:
        supabase = get_supabase()
    except Exception:
        logger.error("Supabase client initialization failed for daily log load", extra={"user_id": user_id})
        raise HTTPException(status_code=503, detail="Daily log storage is unavailable") from None

    data = await fetch_daily_log(supabase, user_id=user_id, log_date=log_date)
    return DailyLogResponse(saved_tables=[], **data)


@app.put("/api/v1/user/{user_id}/daily-log", response_model=DailyLogResponse)
async def save_daily_log(user_id: int, daily_log: DailyLogRequest) -> DailyLogResponse:
    if user_id <= 0:
        raise HTTPException(status_code=422, detail="user_id must be a positive integer")

    table_payloads = _daily_log_table_payloads(user_id, daily_log)
    try:
        if database_marked_unreachable():
            raise RuntimeError("database unreachable")
        supabase = get_supabase()
        saved_tables = await upsert_daily_log_tables(
            supabase,
            user_id=user_id,
            log_date=daily_log.log_date,
            table_payloads=table_payloads,
        )
        data = await fetch_daily_log(supabase, user_id=user_id, log_date=daily_log.log_date)
        if saved_tables:
            return DailyLogResponse(saved_tables=saved_tables, **data)
    except Exception:
        logger.warning("Daily log save failed on the hosted database; saving locally", extra={"user_id": user_id})

    # Hosted database unavailable: keep the check-in on this server so it still counts.
    memory = {k: v for k, v in table_payloads["daily_user_memory_logs"].items() if v not in (None, "", [])}
    day = daily_log.log_date.isoformat()
    await asyncio.to_thread(
        get_collected_store().write_fields,
        user_id=user_id,
        source="check_in",
        rows={"daily_user_memory_logs": {day: memory}},
    )
    return DailyLogResponse(
        user_id=user_id,
        log_date=day,
        saved_tables=["daily_user_memory_logs"],
        tables={"daily_user_memory_logs": memory},
    )


@app.put("/api/v1/user/{user_id}/setup-context", response_model=SetupContextResponse)
async def save_setup_context(user_id: int, setup_context: SetupContextRequest) -> SetupContextResponse:
    if user_id <= 0:
        raise HTTPException(status_code=422, detail="user_id must be a positive integer")

    try:
        supabase = get_supabase()
    except Exception:
        logger.error("Supabase client initialization failed for setup context save", extra={"user_id": user_id})
        raise HTTPException(status_code=503, detail="Setup context storage is unavailable") from None

    try:
        saved_tables = await upsert_setup_context_tables(
            supabase,
            user_id=user_id,
            table_payloads=_setup_context_payloads(setup_context),
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Setup context save timed out") from None
    except Exception:
        raise HTTPException(status_code=500, detail="Setup context save failed") from None

    return SetupContextResponse(user_id=user_id, saved_tables=saved_tables)


@app.get("/api/v1/user/{user_id}/setup-context", response_model=SetupContextLoadResponse)
async def get_setup_context(user_id: int) -> SetupContextLoadResponse:
    if user_id <= 0:
        raise HTTPException(status_code=422, detail="user_id must be a positive integer")

    try:
        supabase = get_supabase()
    except Exception:
        logger.error("Supabase client initialization failed for setup context load", extra={"user_id": user_id})
        raise HTTPException(status_code=503, detail="Setup context storage is unavailable") from None

    try:
        context = await load_user_health_context(supabase, user_id)
    except Exception:
        logger.error("Setup context load failed", extra={"user_id": user_id})
        raise HTTPException(status_code=500, detail="Setup context load failed") from None

    return SetupContextLoadResponse(
        user_id=user_id,
        tables={key: value for key, value in context.items() if isinstance(value, dict)},
    )


@app.get("/api/v1/user/{user_id}/wellness-forecast", response_model=WellnessForecastResponse)
async def get_wellness_forecast(user_id: int) -> WellnessForecastResponse:
    if user_id <= 0:
        raise HTTPException(status_code=422, detail="user_id must be a positive integer")

    try:
        supabase = get_supabase()
    except Exception:
        logger.error("Supabase client initialization failed for wellness forecast", extra={"user_id": user_id})
        raise HTTPException(status_code=503, detail="Wellness forecast data is unavailable") from None

    try:
        user_profile, daily_data, chatbot_history, ai_health_insights = await asyncio.gather(
            load_user_health_context(supabase, user_id),
            load_recent_daily_data(supabase, user_id, 30),
            load_recent_chatbot_history(supabase, user_id, 60),
            load_recent_ai_health_insights(supabase, user_id, 30),
        )
    except Exception:
        logger.error("Wellness forecast context load failed", extra={"user_id": user_id})
        raise HTTPException(status_code=500, detail="Wellness forecast context load failed") from None

    forecast = build_wellness_forecast(
        user_id=user_id,
        user_profile=user_profile,
        daily_data=daily_data,
        chatbot_history=chatbot_history,
        ai_health_insights=ai_health_insights,
    )
    forecast["data_mode"] = "demo" if user_id in DEMO_USER_IDS else "live"
    return WellnessForecastResponse(**forecast)


@app.get("/api/v1/user/{user_id}/locality-health-intelligence", response_model=LocalityHealthIntelligenceResponse)
async def get_locality_health_intelligence(
    user_id: int,
    city: str = Query(default="Bengaluru", min_length=1, max_length=80),
    locality: str = Query(default="Koramangala", min_length=1, max_length=120),
    radius_km: float = Query(default=3.0, ge=0.5, le=25.0),
) -> LocalityHealthIntelligenceResponse:
    if user_id <= 0:
        raise HTTPException(status_code=422, detail="user_id must be a positive integer")

    try:
        supabase = get_supabase()
    except Exception:
        logger.warning(
            "Supabase unavailable for locality intelligence; returning deterministic demo intelligence",
            extra={"user_id": user_id, "city": city, "locality": locality},
        )
        intelligence = build_locality_health_intelligence(
            user_id=user_id,
            city=city,
            locality=locality,
            radius_km=radius_km,
        )
        return LocalityHealthIntelligenceResponse(**intelligence)

    try:
        user_profile, daily_data, chatbot_history, ai_health_insights = await asyncio.gather(
            load_user_health_context(supabase, user_id),
            load_recent_daily_data(supabase, user_id, 30),
            load_recent_chatbot_history(supabase, user_id, 80),
            load_recent_ai_health_insights(supabase, user_id, 40),
        )
    except Exception:
        logger.error("Locality intelligence context load failed", extra={"user_id": user_id})
        raise HTTPException(status_code=500, detail="Locality intelligence context load failed") from None

    intelligence = build_locality_health_intelligence(
        user_id=user_id,
        city=city,
        locality=locality,
        radius_km=radius_km,
        user_profile=user_profile,
        daily_data=daily_data,
        chatbot_history=chatbot_history,
        ai_health_insights=ai_health_insights,
    )
    return LocalityHealthIntelligenceResponse(**intelligence)


# ---------------------------------------------------------------------------
# Health records, medicines, doctor report and nearby doctors
# ---------------------------------------------------------------------------

_EXTENSION_MIME = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
}


def _require_user_id(user_id: int) -> None:
    if user_id <= 0:
        raise HTTPException(status_code=422, detail="user_id must be a positive integer")


def _upload_mime(file: UploadFile) -> str:
    mime = (file.content_type or "").split(";")[0].strip().lower()
    if mime in SUPPORTED_MIME_TYPES:
        return mime
    suffix = os.path.splitext(file.filename or "")[1].lower()
    return _EXTENSION_MIME.get(suffix, mime)


async def _load_forecast_context(user_id: int) -> tuple[dict[str, Any], dict[str, Any]]:
    """The wellness forecast plus the profile tables it was built from."""
    supabase = get_supabase()
    user_profile, daily_data, chatbot_history, ai_health_insights = await asyncio.gather(
        load_user_health_context(supabase, user_id),
        load_recent_daily_data(supabase, user_id, 30),
        load_recent_chatbot_history(supabase, user_id, 60),
        load_recent_ai_health_insights(supabase, user_id, 30),
    )
    forecast = build_wellness_forecast(
        user_id=user_id,
        user_profile=user_profile,
        daily_data=daily_data,
        chatbot_history=chatbot_history,
        ai_health_insights=ai_health_insights,
    )
    return forecast, user_profile


@app.post("/api/v1/user/{user_id}/records")
async def upload_record(request: Request, user_id: int, file: UploadFile = File(...)) -> dict[str, Any]:
    """Read a lab report, prescription or discharge summary (photo or PDF) into the user's record."""
    _require_user_id(user_id)
    mime = _upload_mime(file)
    if mime not in SUPPORTED_MIME_TYPES:
        raise HTTPException(status_code=415, detail="Upload a PDF or a photo (JPG, PNG, WEBP or HEIC).")
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="That file is over 15 MB. Try a smaller photo or a PDF.")
    if not data:
        raise HTTPException(status_code=422, detail="The file is empty.")

    store = get_records_store()
    digest = store.file_hash(data)
    existing = await asyncio.to_thread(store.find_by_hash, user_id, digest)
    if existing is not None:
        # Same file again (e.g. from email and from the gallery): don't read or store it twice.
        return {**existing, "duplicate": True}

    ai_client = _ai_client(request.app)
    if ai_client is None or not hasattr(ai_client, "generate_json"):
        raise HTTPException(status_code=503, detail="The document reader needs the Gemini AI, which is not configured.")
    try:
        extracted = await extract_document(ai_client, data, mime)
    except Exception:
        logger.error("Record extraction failed", extra={"user_id": user_id, "mime": mime})
        raise HTTPException(status_code=502, detail="Couldn't read that document right now. Please try again.") from None
    if not extracted["is_medical_document"]:
        raise HTTPException(
            status_code=422,
            detail="This doesn't look like a medical document. Upload a lab report, prescription or discharge summary.",
        )

    file_path = await asyncio.to_thread(store.save_upload, user_id, file.filename or "upload", data)
    record = await asyncio.to_thread(
        store.add_record,
        user_id=user_id,
        file_name=file.filename or "upload",
        mime_type=mime,
        file_path=file_path,
        extracted=extracted,
        file_hash=digest,
    )
    return {**record, "duplicate": False}


@app.get("/api/v1/user/{user_id}/records")
async def list_records(user_id: int) -> dict[str, Any]:
    _require_user_id(user_id)
    store = get_records_store()
    records, summary = await asyncio.gather(
        asyncio.to_thread(store.list_records, user_id),
        asyncio.to_thread(build_records_summary, store, user_id),
    )
    return {"records": records, "summary": summary}


@app.delete("/api/v1/user/{user_id}/records/{record_id}")
async def delete_record(user_id: int, record_id: str) -> dict[str, bool]:
    _require_user_id(user_id)
    deleted = await asyncio.to_thread(get_records_store().delete_record, user_id, record_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Record not found")
    return {"deleted": True}


class StartMedicationsRequest(BaseModel):
    indices: list[int] | None = None


@app.post("/api/v1/user/{user_id}/records/{record_id}/medications")
async def start_medications(user_id: int, record_id: str, payload: StartMedicationsRequest) -> dict[str, Any]:
    """Turn the medicines read from a prescription into reminders."""
    _require_user_id(user_id)
    store = get_records_store()
    record = await asyncio.to_thread(store.get_record, user_id, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Record not found")
    meds = record["extracted"].get("medications") or []
    chosen = [meds[i] for i in payload.indices if 0 <= i < len(meds)] if payload.indices is not None else meds
    existing = {
        (m.get("record_id"), m["name"].lower())
        for m in await asyncio.to_thread(store.list_medications, user_id, include_inactive=True)
    }
    created = []
    for med in chosen:
        if (record_id, med["name"].lower()) in existing:
            continue
        created.append(await asyncio.to_thread(store.add_medication, user_id=user_id, record_id=record_id, med=med))
    return {"created": created}


@app.get("/api/v1/user/{user_id}/medications/today")
async def medications_today(user_id: int) -> dict[str, Any]:
    _require_user_id(user_id)
    store = get_records_store()
    schedule, medications = await asyncio.gather(
        asyncio.to_thread(todays_doses, store, user_id),
        asyncio.to_thread(store.list_medications, user_id),
    )
    return {**schedule, "medications": medications}


class DoseLogRequest(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    time: str = Field(pattern=r"^\d{2}:\d{2}$")
    status: Literal["taken", "skipped", "pending"]


@app.put("/api/v1/user/{user_id}/medications/{med_id}/doses")
async def log_dose(user_id: int, med_id: str, payload: DoseLogRequest) -> dict[str, Any]:
    _require_user_id(user_id)
    store = get_records_store()
    await asyncio.to_thread(
        store.log_dose, user_id=user_id, med_id=med_id, dose_date=payload.date, dose_time=payload.time, status=payload.status
    )
    return await asyncio.to_thread(todays_doses, store, user_id)


class MedicationUpdateRequest(BaseModel):
    active: bool | None = None
    times: list[str] | None = None

    @field_validator("times")
    @classmethod
    def _valid_times(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return value
        for clock in value:
            hours, _, minutes = clock.partition(":")
            if not (hours.isdigit() and minutes.isdigit() and int(hours) < 24 and int(minutes) < 60 and len(minutes) == 2):
                raise ValueError("times must be HH:MM")
        return sorted(f"{int(c.split(':')[0]):02d}:{c.split(':')[1]}" for c in value)


@app.patch("/api/v1/user/{user_id}/medications/{med_id}")
async def update_medication(user_id: int, med_id: str, payload: MedicationUpdateRequest) -> dict[str, Any]:
    _require_user_id(user_id)
    updated = await asyncio.to_thread(
        get_records_store().update_medication, user_id, med_id, payload.model_dump(exclude_none=True)
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Medicine not found")
    return updated


class DoctorReportRequest(BaseModel):
    user_name: str = Field(default="", max_length=80)
    specialty: str | None = Field(default=None, max_length=60)
    concern: str = Field(default="", max_length=600)
    session_id: str | None = Field(default=None, max_length=128)
    conversation: list[dict[str, str]] | None = None


@app.post("/api/v1/user/{user_id}/doctor-report")
async def doctor_report(request: Request, user_id: int, payload: DoctorReportRequest) -> dict[str, Any]:
    """A one-page summary to show the doctor: complaint, timeline, lifestyle, history, medicines, labs."""
    _require_user_id(user_id)
    try:
        forecast, profile = await _load_forecast_context(user_id)
    except Exception:
        logger.error("Doctor report context load failed", extra={"user_id": user_id})
        raise HTTPException(status_code=503, detail="Your health data is unavailable right now") from None

    conversation = [
        {"role": turn.get("role", ""), "content": turn.get("content", "")[:2000]}
        for turn in (payload.conversation or [])[-20:]
        if turn.get("role") in {"user", "assistant"}
    ]
    if not conversation and payload.session_id:
        state = conversation_store.get(user_id, payload.session_id)
        if state is not None:
            conversation = [{"role": t["role"], "content": t["content"]} for t in state.turns[-20:]]

    store = get_records_store()
    records = await asyncio.to_thread(build_records_summary, store, user_id)
    return await build_doctor_report(
        ai_client=_ai_client(request.app),
        user_name=payload.user_name.strip() or f"User {user_id}",
        specialty=payload.specialty,
        concern=payload.concern.strip(),
        conversation=conversation,
        forecast=forecast,
        profile=profile,
        records=records,
    )


@app.get("/api/v1/doctors/nearby")
async def doctors_nearby(
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    specialty: str | None = Query(default=None, max_length=60),
    radius_km: float = Query(default=5.0, ge=0.5, le=25.0),
) -> dict[str, Any]:
    try:
        return await find_nearby(lat, lng, specialty, radius_m=int(radius_km * 1000))
    except Exception:
        logger.error("Nearby doctor search failed")
        raise HTTPException(status_code=502, detail="Couldn't search for doctors nearby right now.") from None


# ---------------------------------------------------------------------------
# Automatic data collection: location, phone data, order emails
# ---------------------------------------------------------------------------

COLLECT_SOURCES = {"location", "health_connect", "apple_health", "calendar", "screen_time", "gmail", "check_in", "notifications", "band"}
MAX_REPORTS_PER_SYNC = 3


class EnvironmentRequest(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


@app.post("/api/v1/user/{user_id}/collect/environment")
async def collect_environment(user_id: int, payload: EnvironmentRequest) -> dict[str, Any]:
    """Weather and air quality where the user is, for today and the past two weeks.
    Only the area name is kept, never the coordinates."""
    _require_user_id(user_id)
    try:
        environment = await fetch_environment(payload.lat, payload.lng)
    except Exception:
        logger.error("Environment fetch failed", extra={"user_id": user_id})
        raise HTTPException(status_code=502, detail="Couldn't get weather and air quality right now.") from None
    store = get_collected_store()
    written = await asyncio.to_thread(
        store.write_fields, user_id=user_id, source="location", rows={"daily_environment_data": environment["rows"]}
    )
    result = {"place": environment["place"]["label"], "days": len(environment["rows"]), "fields": written}
    await asyncio.to_thread(store.mark_sync, user_id, "location", result)
    return {
        "place": environment["place"],
        "today": environment["today"],
        "alerts": environment["alerts"],
        "days_saved": len(environment["rows"]),
    }


@app.post("/api/v1/user/{user_id}/collect/device")
async def collect_device(user_id: int, payload: DevicePayload) -> dict[str, Any]:
    """Daily aggregates from the phone: Health Connect / Apple Health, calendar load, screen time."""
    _require_user_id(user_id)
    rows = map_device_payload(payload)
    store = get_collected_store()
    written = await asyncio.to_thread(store.write_fields, user_id=user_id, source=payload.source, rows=rows)
    result = {"days": len({day for by_date in rows.values() for day in by_date}), "fields": written}
    await asyncio.to_thread(store.mark_sync, user_id, payload.source, result)
    return result


class EmailIn(BaseModel):
    id: str = Field(min_length=1, max_length=200)
    sender: str = Field(min_length=3, max_length=300)
    subject: str = Field(default="", max_length=500)
    sent_at: datetime
    text: str = Field(default="", max_length=20000)


class EmailBatchRequest(BaseModel):
    emails: list[EmailIn] = Field(max_length=60)
    utc_offset_minutes: int = Field(default=330, ge=-720, le=840)


class GmailSyncRequest(BaseModel):
    access_token: str = Field(min_length=10, max_length=4096)
    days: int = Field(default=30, ge=1, le=90)
    utc_offset_minutes: int = Field(default=330, ge=-720, le=840)


def _ai_client_for_reading(request: Request) -> Any:
    ai_client = _ai_client(request.app)
    if ai_client is None or not hasattr(ai_client, "generate_json"):
        raise HTTPException(status_code=503, detail="Reading emails needs the Gemini AI, which is not configured.")
    return ai_client


async def _ingest_emails(
    ai_client: Any,
    user_id: int,
    messages: list[EmailMessage],
    *,
    utc_offset_minutes: int,
    gmail: tuple[httpx.AsyncClient, str] | None = None,
    source: str = "gmail",
) -> dict[str, Any]:
    store = get_collected_store()
    try:
        parsed = await classify_emails(ai_client, messages) if messages else []
    except Exception:
        logger.error("Email classification failed", extra={"user_id": user_id})
        raise HTTPException(status_code=502, detail="Couldn't read those emails right now. Please try again.") from None

    rows, items = order_rows(parsed, utc_offset_minutes=utc_offset_minutes)
    await asyncio.to_thread(store.write_fields, user_id=user_id, source=source, rows=rows)
    added = 0
    for item in items:
        if await asyncio.to_thread(store.add_item, user_id=user_id, source=source, **item):
            added += 1
    # Remember mail that turned out to be irrelevant so the next sync doesn't read it again.
    for entry in parsed:
        if entry.get("kind") == "not_relevant":
            message = entry["email"]
            await asyncio.to_thread(
                store.add_item,
                user_id=user_id,
                source=source,
                item_id=message.id,
                happened_at=message.sent_at.isoformat(timespec="minutes"),
                kind="not_relevant",
                summary=message.subject[:120],
                details={},
            )

    reports_added = 0
    if gmail is not None:
        client, token = gmail
        records = get_records_store()
        for entry in parsed:
            message = entry["email"]
            if entry.get("kind") not in {"lab_report", "lab_booking"} or not message.pdf_attachments:
                continue
            for filename, attachment_id in message.pdf_attachments:
                if reports_added >= MAX_REPORTS_PER_SYNC:
                    break
                try:
                    data = await fetch_gmail_attachment(client, token, message.id, attachment_id)
                    if not data or len(data) > MAX_UPLOAD_BYTES:
                        continue
                    digest = records.file_hash(data)
                    if await asyncio.to_thread(records.find_by_hash, user_id, digest):
                        continue
                    extracted = await extract_document(ai_client, data, "application/pdf")
                    if not extracted["is_medical_document"]:
                        continue
                    path = await asyncio.to_thread(records.save_upload, user_id, filename, data)
                    await asyncio.to_thread(
                        records.add_record,
                        user_id=user_id,
                        file_name=filename,
                        mime_type="application/pdf",
                        file_path=path,
                        extracted=extracted,
                        file_hash=digest,
                    )
                    reports_added += 1
                except Exception:
                    logger.warning("Lab report attachment could not be read", extra={"user_id": user_id})

    result = {"emails_read": len(messages), "orders_found": len(items), "new_items": added, "reports_added": reports_added}
    await asyncio.to_thread(store.mark_sync, user_id, source, result)
    return {**result, "items": [{k: item[k] for k in ("happened_at", "kind", "summary")} for item in items]}


class AppAlertIn(BaseModel):
    id: str = Field(min_length=1, max_length=200)
    package: str = Field(min_length=3, max_length=200)
    title: str = Field(default="", max_length=300)
    text: str = Field(default="", max_length=2000)
    posted_at: datetime


class AppAlertBatchRequest(BaseModel):
    alerts: list[AppAlertIn] = Field(max_length=100)
    utc_offset_minutes: int = Field(default=330, ge=-720, le=840)


# Android package -> the merchant's mail domain, so app alerts go through the same allowlist and
# order reader as receipts. Anything not listed here is dropped unread.
APP_PACKAGE_SENDERS = {
    "in.swiggy.android": "alerts@swiggy.in",
    "com.application.zomato": "alerts@zomato.com",
    "com.grofers.customerapp": "alerts@blinkit.com",
    "com.zeptoconsumerapp": "alerts@zeptonow.com",
    "com.bigbasket.mobileapp": "alerts@bigbasket.com",
    "com.jpl.jiomart": "alerts@jiomart.com",
    "com.done.faasos": "alerts@eatsure.com",
    "com.dominos": "alerts@dominos.co.in",
    "com.aranoah.healthkart.plus": "alerts@1mg.com",
    "com.phonegap.rxpal": "alerts@pharmeasy.in",
    "com.netmedsmarketplace.netmeds": "alerts@netmeds.com",
    "com.apollo.patientapp": "alerts@apollo247.com",
    "com.practo.fabric": "alerts@practo.com",
}


@app.post("/api/v1/user/{user_id}/collect/notifications")
async def collect_app_alerts(request: Request, user_id: int, payload: AppAlertBatchRequest) -> dict[str, Any]:
    """Order and delivery alerts captured on the phone (Android notification access, switched on by
    the user). Only alerts from known food, grocery and pharmacy apps are read; the rest are dropped."""
    _require_user_id(user_id)
    ai_client = _ai_client_for_reading(request)
    messages = [
        EmailMessage(
            id=f"app:{alert.id}",
            sender=APP_PACKAGE_SENDERS[alert.package.lower()],
            subject=alert.title,
            sent_at=alert.posted_at,
            text=f"{alert.title}\n{alert.text}"[:1500],
        )
        for alert in payload.alerts
        if alert.package.lower() in APP_PACKAGE_SENDERS
    ]
    result = await _ingest_emails(ai_client, user_id, messages, utc_offset_minutes=payload.utc_offset_minutes, source="notifications")
    return {**result, "alerts_read": result.pop("emails_read")}


@app.post("/api/v1/user/{user_id}/collect/emails")
async def collect_emails(request: Request, user_id: int, payload: EmailBatchRequest) -> dict[str, Any]:
    """Order emails read on the device (or forwarded). Mail from senders that are not
    food, grocery, pharmacy, lab, fitness or travel merchants is dropped unread."""
    _require_user_id(user_id)
    ai_client = _ai_client_for_reading(request)
    messages = [
        EmailMessage(id=e.id, sender=e.sender, subject=e.subject, sent_at=e.sent_at, text=e.text[:2500])
        for e in payload.emails
        if sender_category(e.sender)
    ]
    return await _ingest_emails(ai_client, user_id, messages, utc_offset_minutes=payload.utc_offset_minutes)


@app.post("/api/v1/user/{user_id}/collect/gmail")
async def collect_gmail(request: Request, user_id: int, payload: GmailSyncRequest) -> dict[str, Any]:
    """Read order and lab emails with a read-only Gmail token from the app. The token is used
    for this sync only and never stored."""
    _require_user_id(user_id)
    ai_client = _ai_client_for_reading(request)
    store = get_collected_store()
    skip = await asyncio.to_thread(store.item_ids, user_id, "gmail")
    async with httpx.AsyncClient(timeout=20.0) as client:
        try:
            messages = await fetch_gmail_messages(client, payload.access_token, days=payload.days, skip_ids=skip)
        except PermissionError:
            raise HTTPException(status_code=401, detail="Gmail access has expired. Connect Gmail again.") from None
        except httpx.HTTPError:
            logger.error("Gmail fetch failed", extra={"user_id": user_id})
            raise HTTPException(status_code=502, detail="Couldn't reach Gmail right now.") from None
        return await _ingest_emails(
            ai_client,
            user_id,
            messages,
            utc_offset_minutes=payload.utc_offset_minutes,
            gmail=(client, payload.access_token),
        )


@app.get("/api/v1/user/{user_id}/factors")
async def get_health_factors(
    user_id: int,
    platform: Literal["android", "ios", "web"] | None = Query(default=None),
    connected: str = Query(default="", max_length=400, description="Comma-separated source ids switched on in the app"),
    sex: Literal["male", "female"] | None = Query(default=None),
) -> dict[str, Any]:
    """Everything that can affect this person's health, what we know about each and how we know it."""
    _require_user_id(user_id)
    today = date.today()
    store = get_collected_store()
    since = (today - timedelta(days=35)).isoformat()
    field_sources, server_connections, items = await asyncio.gather(
        asyncio.to_thread(store.field_sources, user_id, since),
        asyncio.to_thread(store.connections, user_id),
        asyncio.to_thread(store.recent_items, user_id, 150),
    )

    merged: dict[str, Any] = {}
    profile: dict[str, Any] = {}
    try:
        if database_marked_unreachable():
            raise RuntimeError("database unreachable")
        supabase = get_supabase()
        merged, profile = await asyncio.gather(load_recent_daily_data(supabase, user_id, 30), load_user_health_context(supabase, user_id))
    except Exception:
        logger.warning("Factor context partly unavailable", extra={"user_id": user_id})
        collected = await asyncio.to_thread(store.read_days, user_id, since)
        merged = {table: [{"log_date": d, **row} for d, row in sorted(by_date.items(), reverse=True)] for table, by_date in collected.items()}
    days = days_by_date(merged)

    env_rows = days.get("daily_environment_data", {})
    assessment = assess_risks(env_rows, today=today) if env_rows else {"risks": []}
    latest_env = env_rows[max(env_rows)] if env_rows else {}
    notices = notices_for(await fetch_notices(), latest_env.get("country")) if latest_env.get("country") else []
    try:
        records = await asyncio.to_thread(build_records_summary, get_records_store(), user_id)
    except Exception:
        records = {}

    ctx = FactorCtx(
        today=today,
        days=days,
        field_sources=field_sources,
        connected=connected_sources(server_connections, [c.strip() for c in connected.split(",") if c.strip()]),
        risks={risk["id"]: risk for risk in assessment["risks"]},
        outbreaks=notices,
        records=records,
        profile={k: v for k, v in profile.items() if isinstance(v, dict)},
        memory=list(merged.get("daily_user_memory_logs") or []),
        items=items,
        sex=sex,
        demo=user_id in DEMO_USER_IDS,
    )
    result = build_factors(ctx, platform=platform)
    result["risks"] = assessment["risks"]
    result["outbreaks"] = notices
    result["place"] = latest_env.get("location")
    return result


@app.get("/api/v1/user/{user_id}/collect/status")
async def collect_status(user_id: int) -> dict[str, Any]:
    """What has been collected automatically, from where, and when it last synced."""
    _require_user_id(user_id)
    return await asyncio.to_thread(collection_status, get_collected_store(), user_id)


@app.delete("/api/v1/user/{user_id}/collect/{source}")
async def disconnect_source(user_id: int, source: str) -> dict[str, Any]:
    """Disconnect a source and delete everything collected from it."""
    _require_user_id(user_id)
    if source not in COLLECT_SOURCES:
        raise HTTPException(status_code=404, detail="Unknown source")
    await asyncio.to_thread(get_collected_store().delete_source, user_id, source)
    return {"disconnected": source, "data_deleted": True}
