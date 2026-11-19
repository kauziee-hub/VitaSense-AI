"""Google Gemini client with the same surface as GrokClient.

The orchestrator only needs `chat(...)` (an async stream of text chunks),
`verify_models()`, `health_check()` and `close()`. Requests walk a chain of
models so a busy or retired model does not take chat down.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, AsyncIterator

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-3.7-flash"
# Each model has its own quota on a key, so a longer chain keeps chat up when one runs out.
# Models that fail (quota, overload) cool down and move to the back, so the chain costs little.
DEFAULT_FALLBACK_MODELS = (
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
    "gemini-3.8-flash",
)
# Errors that will fail the same way on every model (bad request, bad key): don't retry.
# Everything else (timeouts, overload 429/503, retired model 404, network) moves to the next model.
FATAL_CODES = {400, 401, 403}
# Gemini 3 models think before answering; thinking tokens count against the
# output budget, so give them headroom on top of the visible answer length.
THINKING_HEADROOM_TOKENS = 1536


def _model_chain() -> list[str]:
    primary = os.environ.get("GEMINI_MODEL", "").strip() or DEFAULT_MODEL
    extra = os.environ.get("GEMINI_FALLBACK_MODELS", "")
    fallbacks = [item.strip() for item in extra.split(",") if item.strip()] or list(DEFAULT_FALLBACK_MODELS)
    chain: list[str] = []
    for model in [primary, *fallbacks]:
        if model not in chain:
            chain.append(model)
    return chain


def _status_code(exc: Exception) -> int | None:
    for attr in ("code", "status_code"):
        value = getattr(exc, attr, None)
        if isinstance(value, int):
            return value
    return None


def _is_retryable(exc: Exception) -> bool:
    return _status_code(exc) not in FATAL_CODES


class GeminiClient:
    PROVIDER = "gemini"
    # A busy model can hang without sending anything. If no words arrive within
    # FIRST_TOKEN_SECONDS, give up on it and try the next model.
    FIRST_TOKEN_SECONDS = 8.0
    # Once words are flowing, a gap this long means the stream has died.
    IDLE_SECONDS = 20.0
    # Whole-request cap for non-streaming calls (and the HTTP client).
    TIMEOUT_SECONDS = 30.0
    # A model that just hung or was overloaded is tried last for this long, so the
    # next user does not wait on it again.
    COOLDOWN_SECONDS = 300.0

    def __init__(self) -> None:
        load_dotenv()
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY environment variable is not set")

        from google import genai
        from google.genai import types

        self._types = types
        self._client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(timeout=int(self.TIMEOUT_SECONDS * 1000)),
        )
        self._models = _model_chain()
        self._verified_models: list[str] = []
        self._cooling_until: dict[str, float] = {}

    @property
    def models(self) -> list[str]:
        return list(self._models)

    @property
    def verified_models(self) -> list[str]:
        return list(self._verified_models)

    def _ordered(self, chain: list[str]) -> list[str]:
        """Healthy models first, in configured order; models cooling down go last."""
        now = time.monotonic()
        healthy = [m for m in chain if self._cooling_until.get(m, 0.0) <= now]
        cooling = [m for m in chain if m not in healthy]
        return healthy + cooling

    def _cool_down(self, model: str) -> None:
        self._cooling_until[model] = time.monotonic() + self.COOLDOWN_SECONDS

    def _recovered(self, model: str) -> None:
        self._cooling_until.pop(model, None)

    async def verify_models(self) -> list[str]:
        available: list[str] = []
        try:
            pager = await self._client.aio.models.list(config={"page_size": 200})
            async for model in pager:
                name = str(getattr(model, "name", "")).removeprefix("models/")
                if name:
                    available.append(name)
        except Exception as exc:
            logger.error("Gemini model listing failed")
            raise RuntimeError("Gemini model verification failed") from exc

        usable = [model for model in self._models if model in available]
        if not usable:
            raise RuntimeError(f"None of the configured Gemini models are available: {self._models}")
        self._models = usable
        self._verified_models = available
        logger.info("Gemini model verification succeeded", extra={"models": usable})
        return self.verified_models

    def _split_messages(self, messages: list[dict[str, Any]]) -> tuple[str | None, list[Any]]:
        types = self._types
        system_parts: list[str] = []
        contents: list[Any] = []
        for message in messages:
            role = str(message.get("role", "user")).lower()
            text = str(message.get("content", ""))
            if not text:
                continue
            if role == "system":
                system_parts.append(text)
                continue
            gemini_role = "model" if role in {"assistant", "model", "bot", "ai"} else "user"
            contents.append(types.Content(role=gemini_role, parts=[types.Part(text=text)]))
        system = "\n\n".join(system_parts) or None
        return system, contents

    def _config(self, system: str | None, temperature: float, max_tokens: int) -> Any:
        types = self._types
        return types.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
            max_output_tokens=max_tokens + THINKING_HEADROOM_TOKENS,
            thinking_config=types.ThinkingConfig(thinking_level="low"),
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )

    async def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        model: str | None = None,
        temperature: float = 0.3,
        max_tokens: int = 1200,
        stream: bool = True,
    ) -> Any:
        """Stream=True returns an async iterator of text chunks; otherwise the full text."""
        system, contents = self._split_messages(messages)
        config = self._config(system, temperature, max_tokens)
        chain = [model, *[m for m in self._models if m != model]] if model else self.models

        if stream:
            return self._stream_with_fallback(chain, contents, config)

        last_error: Exception | None = None
        for candidate in self._ordered(chain):
            try:
                response = await asyncio.wait_for(
                    self._client.aio.models.generate_content(model=candidate, contents=contents, config=config),
                    self.TIMEOUT_SECONDS,
                )
                self._recovered(candidate)
                return response.text or ""
            except Exception as exc:
                last_error = exc
                if not _is_retryable(exc):
                    break
                self._cool_down(candidate)
                logger.warning("Gemini model unavailable; trying next", extra={"model": candidate})
        logger.error("Gemini chat request failed on every model")
        raise RuntimeError("Gemini chat request failed") from last_error

    async def _stream_with_fallback(
        self,
        chain: list[str],
        contents: list[Any],
        config: Any,
        first_token_seconds: float | None = None,
    ) -> AsyncIterator[str]:
        last_error: Exception | None = None
        loop = asyncio.get_running_loop()
        first_token = first_token_seconds or self.FIRST_TOKEN_SECONDS
        slow: list[str] = []  # models that only missed the first-words deadline (not overloaded or refused)
        for candidate in self._ordered(chain):
            started = False
            iterator: Any = None
            deadline = loop.time() + first_token
            try:
                stream = await asyncio.wait_for(
                    self._client.aio.models.generate_content_stream(model=candidate, contents=contents, config=config),
                    first_token,
                )
                iterator = stream.__aiter__()
                while True:
                    # Thinking chunks carry no text, so the first-words deadline is
                    # measured from the request, not from the last chunk.
                    wait = self.IDLE_SECONDS if started else max(0.05, deadline - loop.time())
                    try:
                        chunk = await asyncio.wait_for(iterator.__anext__(), wait)
                    except StopAsyncIteration:
                        break
                    text = getattr(chunk, "text", None)
                    if text:
                        started = True
                        yield text
                self._recovered(candidate)
                return
            except Exception as exc:
                last_error = exc
                # Once text has reached the caller, switching models would garble the answer.
                if started or not _is_retryable(exc):
                    break
                if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
                    slow.append(candidate)
                self._cool_down(candidate)
                logger.warning(
                    "Gemini model unavailable; trying next",
                    extra={"model": candidate, "error": type(exc).__name__, "status": _status_code(exc)},
                )
            finally:
                close = getattr(iterator, "aclose", None)
                if close is not None:
                    try:
                        await close()
                    except Exception:
                        pass
        # Every model failed. If one was merely slow to start (e.g. a large prompt on a
        # rate-limited key), give it one more chance with the full time budget.
        if slow and first_token_seconds is None and last_error is not None and _is_retryable(last_error):
            logger.warning("Retrying slow Gemini model with a longer deadline", extra={"model": slow[0]})
            async for text in self._stream_with_fallback(
                [slow[0]], contents, config, first_token_seconds=self.TIMEOUT_SECONDS
            ):
                yield text
            return
        logger.error("Gemini streaming failed on every model")
        raise RuntimeError("Gemini chat request failed") from last_error

    async def generate_json(
        self,
        *,
        prompt: str,
        files: list[tuple[bytes, str]] | None = None,
        schema: dict[str, Any] | None = None,
        system: str | None = None,
        timeout: float | None = None,
        max_tokens: int = 4096,
        first_token_seconds: float = 15.0,
    ) -> Any:
        """One structured answer. `files` are (bytes, mime_type) pairs such as a photo or PDF.

        Streamed under the hood so a model that hangs is dropped after
        `first_token_seconds` instead of after the whole `timeout`.
        """
        types = self._types
        parts = [types.Part.from_bytes(data=data, mime_type=mime) for data, mime in files or []]
        parts.append(types.Part(text=prompt))
        contents = [types.Content(role="user", parts=parts)]
        config = types.GenerateContentConfig(
            system_instruction=system,
            temperature=0.1,
            max_output_tokens=max_tokens + THINKING_HEADROOM_TOKENS,
            response_mime_type="application/json",
            response_json_schema=schema,
            thinking_config=types.ThinkingConfig(thinking_level="low"),
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )
        async def collect(candidate: str) -> str:
            parts_out = [
                text
                async for text in self._stream_with_fallback([candidate], contents, config, first_token_seconds)
            ]
            return "".join(parts_out)

        last_error: Exception | None = None
        for candidate in self._ordered(self._models):
            try:
                text = await asyncio.wait_for(collect(candidate), timeout or self.TIMEOUT_SECONDS)
                return json.loads(text)
            except json.JSONDecodeError as exc:
                # Truncated or malformed JSON: another model may do better, but this one is healthy.
                last_error = exc
                logger.warning("Gemini returned invalid JSON; trying next", extra={"model": candidate})
            except Exception as exc:
                # _stream_with_fallback wraps the provider error; judge retry on the original.
                cause = exc.__cause__ if isinstance(exc, RuntimeError) and exc.__cause__ else exc
                last_error = cause
                if not _is_retryable(cause):
                    break
                if isinstance(exc, asyncio.TimeoutError):
                    self._cool_down(candidate)
        logger.error("Gemini structured request failed on every model")
        raise RuntimeError("Gemini structured request failed") from last_error

    async def health_check(self) -> bool:
        try:
            pager = await self._client.aio.models.list(config={"page_size": 1})
            async for _ in pager:
                break
            return True
        except Exception:
            logger.error("Gemini health check failed")
            return False

    async def close(self) -> None:
        aio = getattr(self._client, "aio", None)
        close = getattr(aio, "aclose", None) or getattr(self._client, "close", None)
        if close is None:
            return
        try:
            result = close()
            if hasattr(result, "__await__"):
                await result
        except Exception:
            logger.error("Gemini client close failed")
