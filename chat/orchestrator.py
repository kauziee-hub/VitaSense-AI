from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Callable

from chat.prompt_builder import build_system_prompt
from chat.safety_scanner import (
    ESCALATION_MESSAGE,
    SafetyResult,
    scan_ai_response,
    scan_user_message,
)
from db.supabase_client import database_marked_unreachable, get_supabase, is_connection_error, mark_unreachable
from db.user_context_loader import load_recent_daily_data, load_user_health_context
from typing import Protocol
from locality.intelligence import build_locality_health_intelligence
from collect.store import get_collected_store
from collect.summary import collected_prompt_lines
from db.demo_seed_data import DEMO_USER_IDS
from records.store import get_records_store
from records.summary import build_records_summary, records_prompt_lines
from state.conversation_store import ConversationStore, conversation_store

logger = logging.getLogger(__name__)

STREAM_ERROR_MESSAGE = (
    "I could not complete the response right now. Please try again in a moment."
)
CUT_OFF_NOTE = "\n\n_The answer was cut off. Please ask again._"
PERSIST_TIMEOUT_SECONDS = 10.0
MAX_RESPONSE_TOKENS = 1200


class ChatModelClient(Protocol):
    async def chat(self, messages: list[dict[str, str]], **kwargs: Any) -> Any: ...


@dataclass(frozen=True)
class OrchestratorDependencies:
    # Named grok_client for backwards compatibility; holds any chat model client (Gemini, Grok).
    grok_client: ChatModelClient
    supabase_factory: Callable[[], Any] = get_supabase
    store: ConversationStore = conversation_store
    records_store_factory: Callable[[], Any] = get_records_store
    collected_store_factory: Callable[[], Any] = get_collected_store


def format_sse_event(data: str) -> str:
    # split("\n"), not splitlines(): a chunk ending in a newline must keep it, or
    # streamed markdown (headings, bullets) runs together on the client.
    lines = data.replace("\r\n", "\n").split("\n")
    return "".join(f"data: {line}\n" for line in lines) + "\n"


async def persist_turn(
    supabase: Any,
    *,
    user_id: int,
    session_id: str,
    role: str,
    content: str,
    symptoms: list[str] | None = None,
    risk_level: str | None = None,
) -> None:
    payload = {
        "user_id": user_id,
        "session_id": session_id,
        "message_role": role,
        "message_content": content,
        "related_symptoms": symptoms or [],
        "ai_risk_level": risk_level,
    }

    if database_marked_unreachable():
        return
    try:
        await asyncio.wait_for(
            asyncio.to_thread(
                lambda: supabase.table("chatbot_conversation_history").insert(payload).execute()
            ),
            timeout=PERSIST_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.error(
            "Conversation persistence timed out",
            extra={"user_id": user_id, "session_id": session_id},
        )
    except Exception as exc:
        if is_connection_error(exc):
            mark_unreachable()
        logger.error(
            "Conversation persistence failed",
            extra={"user_id": user_id, "session_id": session_id},
        )


def _extract_delta(chunk: Any) -> str:
    if isinstance(chunk, str):
        return chunk
    try:
        return chunk.choices[0].delta.content or ""
    except (AttributeError, IndexError, KeyError, TypeError):
        return ""


async def handle_chat_message(
    user_id: int,
    session_id: str,
    user_message: str,
    *,
    dependencies: OrchestratorDependencies,
) -> AsyncGenerator[str, None]:
    supabase = None
    user_scan = scan_user_message(user_message)

    try:
        supabase = dependencies.supabase_factory()
    except Exception:
        logger.error(
            "Supabase client unavailable for chat orchestration",
            extra={"user_id": user_id, "session_id": session_id},
        )

    if user_scan.verdict == SafetyResult.BLOCK:
        response_text = user_scan.modified_response or ESCALATION_MESSAGE
        state = dependencies.store.get_or_create(user_id, session_id)
        state.escalation_flag = True
        state.add_turn("user", user_message)
        state.add_turn("assistant", response_text)

        if supabase is not None:
            await persist_turn(supabase, user_id=user_id, session_id=session_id, role="user", content=user_message)
            await persist_turn(
                supabase,
                user_id=user_id,
                session_id=session_id,
                role="assistant",
                content=response_text,
                risk_level="Critical",
            )

        yield response_text
        return

    state = dependencies.store.get_or_create(user_id, session_id)
    state.add_turn("user", user_message)

    user_profile: dict[str, Any] = {}
    daily_data: dict[str, Any] = {}
    if supabase is not None:
        try:
            user_profile, daily_data = await asyncio.gather(
                load_user_health_context(supabase, user_id),
                load_recent_daily_data(supabase, user_id, 30),
            )
        except Exception:
            logger.error(
                "Context injection failed",
                extra={"user_id": user_id, "session_id": session_id},
            )

    records_lines: list[str] = []
    try:
        records_summary = await asyncio.to_thread(build_records_summary, dependencies.records_store_factory(), user_id)
        records_lines = records_prompt_lines(records_summary)
    except Exception:
        logger.error("Records context failed", extra={"user_id": user_id, "session_id": session_id})

    collected_lines: list[str] = []
    try:
        collected_lines = await asyncio.to_thread(collected_prompt_lines, dependencies.collected_store_factory(), user_id)
    except Exception:
        logger.error("Collected context failed", extra={"user_id": user_id, "session_id": session_id})

    # Sex decides which causes apply (pregnancy and periods vs prostate); the profile sets it.
    if supabase is not None:
        try:
            response = await asyncio.wait_for(
                asyncio.to_thread(lambda: supabase.table("users").select("biological_sex").eq("id", user_id).limit(1).execute()),
                timeout=5.0,
            )
            rows = getattr(response, "data", None) or []
            sex = rows[0].get("biological_sex") if rows and isinstance(rows[0], dict) else None
            if sex in ("male", "female"):
                collected_lines.insert(0, f"Sex: {sex} (only consider causes that apply)")
        except Exception:
            pass

    system_prompt = build_system_prompt(
        user_profile=user_profile,
        daily_data={
            **daily_data,
            # Simulated area intelligence is for the built-in demo profiles only; real users get
            # measured environment data and risk estimates through collected_lines instead.
            **(
                {
                    "locality_health_intelligence": build_locality_health_intelligence(
                        user_id=user_id,
                        user_profile=user_profile,
                        daily_data=daily_data,
                    )
                }
                if user_id in DEMO_USER_IDS
                else {}
            ),
        },
        hypotheses=state.hypotheses,
        follow_up_queue=state.follow_up_queue,
        triage_flags=user_scan.triage_flags,
        records_lines=records_lines,
        collected_lines=collected_lines,
    )
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(state.to_grok_messages(max_turns=10))

    # Stream the model's words as they arrive. The reply-side safety scan only ever
    # appends notes (disclaimer, "never prescribes"), so it runs at the end and its
    # additions are sent as a final chunk.
    parts: list[str] = []
    failed = False
    try:
        stream = await dependencies.grok_client.chat(
            messages,
            stream=True,
            temperature=0.3,
            max_tokens=MAX_RESPONSE_TOKENS,
        )
        async for chunk in stream:
            delta = _extract_delta(chunk)
            if delta:
                parts.append(delta)
                yield delta
    except Exception:
        logger.error(
            "Chat model streaming failed",
            extra={"user_id": user_id, "session_id": session_id, "partial": bool(parts)},
        )
        failed = True

    raw_response = "".join(parts)
    risk_level: str | None = "Medium" if user_scan.triage_flags else None
    if not raw_response.strip():
        response_text = STREAM_ERROR_MESSAGE
        yield STREAM_ERROR_MESSAGE
    else:
        if failed:
            raw_response += CUT_OFF_NOTE
            yield CUT_OFF_NOTE
        ai_scan = scan_ai_response(raw_response)
        if ai_scan.verdict == SafetyResult.BLOCK:
            escalation = ai_scan.modified_response or ESCALATION_MESSAGE
            response_text = f"{raw_response}\n\n{escalation}"
            yield f"\n\n{escalation}"
            state.escalation_flag = True
            risk_level = "Critical"
        else:
            response_text = ai_scan.modified_response or raw_response
            streamed = raw_response.rstrip()
            if response_text.startswith(streamed) and len(response_text) > len(streamed):
                yield response_text[len(streamed):]

    state.add_turn("assistant", response_text)

    if supabase is not None:
        await persist_turn(supabase, user_id=user_id, session_id=session_id, role="user", content=user_message)
        await persist_turn(
            supabase,
            user_id=user_id,
            session_id=session_id,
            role="assistant",
            content=response_text,
            risk_level=risk_level,
        )


async def stream_chat_sse(
    user_id: int,
    session_id: str,
    user_message: str,
    *,
    dependencies: OrchestratorDependencies,
) -> AsyncGenerator[str, None]:
    try:
        async for token in handle_chat_message(
            user_id,
            session_id,
            user_message,
            dependencies=dependencies,
        ):
            yield format_sse_event(token)
    except Exception:
        logger.error(
            "SSE chat stream failed",
            extra={"user_id": user_id, "session_id": session_id},
        )
        yield format_sse_event(STREAM_ERROR_MESSAGE)
    finally:
        yield format_sse_event("[DONE]")
