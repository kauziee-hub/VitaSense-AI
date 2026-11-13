import asyncio
import logging
from typing import Any

from supabase import Client

logger = logging.getLogger(__name__)

SETUP_CONTEXT_TIMEOUT_SECONDS = 10.0

SETUP_CONTEXT_TABLES: tuple[str, ...] = (
    "user_life_context",
    "user_medical_identity",
    "user_food_body_relationship",
    "user_emotional_wellness",
    "user_personal_context",
    "ai_user_health_profile",
)

LEGACY_EMOTIONAL_WELLNESS_COLUMNS: frozenset[str] = frozenset(
    {
        "emotional_tracking_enabled",
        "emotional_pressure_sources",
        "stress_response_pattern",
        "recovery_preference",
    }
)


async def _execute_upsert(supabase: Client, *, table_name: str, payload: dict[str, Any]) -> None:
    await asyncio.wait_for(
        asyncio.to_thread(
            lambda table_name=table_name, payload=payload: (
                supabase.table(table_name)
                .upsert(payload, on_conflict="user_id")
                .execute()
            )
        ),
        timeout=SETUP_CONTEXT_TIMEOUT_SECONDS,
    )


def _is_missing_column_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return (
        "could not find" in message
        and "column" in message
        and "user_emotional_wellness" in message
    )


async def upsert_setup_context_tables(
    supabase: Client,
    *,
    user_id: int,
    table_payloads: dict[str, dict[str, Any]],
) -> list[str]:
    saved_tables: list[str] = []

    for table_name, values in table_payloads.items():
        if table_name not in SETUP_CONTEXT_TABLES:
            continue

        payload = {
            "user_id": user_id,
            **values,
        }

        try:
            await _execute_upsert(supabase, table_name=table_name, payload=payload)
        except asyncio.TimeoutError:
            logger.error("Setup context upsert timed out", extra={"user_id": user_id, "table": table_name})
            raise
        except Exception as exc:
            if table_name == "user_emotional_wellness" and _is_missing_column_error(exc):
                legacy_payload = {
                    key: value
                    for key, value in payload.items()
                    if key == "user_id" or key in LEGACY_EMOTIONAL_WELLNESS_COLUMNS
                }
                logger.warning(
                    "Setup context emotional wellness table is missing extended columns; saved legacy columns only",
                    extra={"user_id": user_id, "table": table_name},
                )
                await _execute_upsert(supabase, table_name=table_name, payload=legacy_payload)
            else:
                logger.error("Setup context upsert failed", extra={"user_id": user_id, "table": table_name})
                raise

        saved_tables.append(table_name)

    return saved_tables
