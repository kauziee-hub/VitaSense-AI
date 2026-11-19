import asyncio

import pytest

import gemini_client
from gemini_client import GeminiClient, _is_retryable, _model_chain


class StatusError(Exception):
    def __init__(self, code):
        super().__init__(f"status {code}")
        self.code = code


def test_model_chain_uses_env_and_dedupes(monkeypatch):
    monkeypatch.setenv("GEMINI_MODEL", "model-a")
    monkeypatch.setenv("GEMINI_FALLBACK_MODELS", "model-b, model-a ,model-c")
    assert _model_chain() == ["model-a", "model-b", "model-c"]


def test_timeouts_and_overload_are_retryable_but_auth_is_not():
    assert _is_retryable(TimeoutError("read timed out"))
    assert _is_retryable(StatusError(503))
    assert _is_retryable(StatusError(404))
    assert not _is_retryable(StatusError(401))
    assert not _is_retryable(StatusError(400))


def _client_with_fake_stream(monkeypatch, behaviours):
    """behaviours: model -> Exception to raise before streaming, or list of text chunks."""
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(gemini_client, "load_dotenv", lambda: None)
    client = GeminiClient()
    client._models = list(behaviours)
    calls = []

    async def fake_stream(*, model, contents, config):
        calls.append(model)
        outcome = behaviours[model]
        if isinstance(outcome, Exception):
            raise outcome

        async def gen():
            for text in outcome:
                yield type("Chunk", (), {"text": text})()

        return gen()

    monkeypatch.setattr(client._client.aio.models, "generate_content_stream", fake_stream)
    return client, calls


def test_stream_falls_back_after_timeout(monkeypatch):
    client, calls = _client_with_fake_stream(
        monkeypatch, {"slow-model": TimeoutError("timed out"), "backup-model": ["Hello ", "there"]}
    )

    async def run():
        stream = await client.chat([{"role": "user", "content": "hi"}])
        return "".join([part async for part in stream])

    assert asyncio.run(run()) == "Hello there"
    assert calls == ["slow-model", "backup-model"]


def test_stream_stops_on_auth_error(monkeypatch):
    client, calls = _client_with_fake_stream(
        monkeypatch, {"model-a": StatusError(401), "model-b": ["never"]}
    )

    async def run():
        stream = await client.chat([{"role": "user", "content": "hi"}])
        return "".join([part async for part in stream])

    with pytest.raises(RuntimeError):
        asyncio.run(run())
    assert calls == ["model-a"]


def test_system_and_assistant_roles_are_mapped(monkeypatch):
    client, _ = _client_with_fake_stream(monkeypatch, {"m": ["x"]})
    system, contents = client._split_messages(
        [
            {"role": "system", "content": "rules"},
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
        ]
    )
    assert system == "rules"
    assert [c.role for c in contents] == ["user", "model"]


def test_stream_gives_up_on_a_model_that_sends_nothing(monkeypatch):
    """A model that accepts the request but never sends words must not stall the chat."""
    client, calls = _client_with_fake_stream(monkeypatch, {"hung-model": [], "backup-model": ["fast answer"]})
    client.FIRST_TOKEN_SECONDS = 0.2
    original = client._client.aio.models.generate_content_stream

    async def stream(*, model, contents, config):
        if model == "hung-model":
            calls.append(model)

            async def silent():
                await asyncio.sleep(30)
                yield None

            return silent()
        return await original(model=model, contents=contents, config=config)

    monkeypatch.setattr(client._client.aio.models, "generate_content_stream", stream)

    async def run():
        loop = asyncio.get_running_loop()
        started = loop.time()
        result = "".join([part async for part in await client.chat([{"role": "user", "content": "hi"}])])
        return result, loop.time() - started

    text, elapsed = asyncio.run(run())
    assert text == "fast answer"
    assert elapsed < 2
    assert calls == ["hung-model", "backup-model"]


def test_failed_model_is_tried_last_on_the_next_request(monkeypatch):
    client, calls = _client_with_fake_stream(monkeypatch, {"busy-model": StatusError(503), "backup-model": ["ok"]})

    async def ask():
        return "".join([part async for part in await client.chat([{"role": "user", "content": "hi"}])])

    assert asyncio.run(ask()) == "ok"
    assert asyncio.run(ask()) == "ok"
    # The second request skipped straight to the backup.
    assert calls == ["busy-model", "backup-model", "backup-model"]


def test_generate_json_skips_bad_json_and_auth_errors_stop(monkeypatch):
    client, calls = _client_with_fake_stream(
        monkeypatch, {"model-a": ['{"name": "trunc'], "model-b": ['{"name": ', '"ok"}']}
    )
    result = asyncio.run(client.generate_json(prompt="read", schema={"type": "object"}))
    assert result == {"name": "ok"}
    assert calls == ["model-a", "model-b"]

    client, calls = _client_with_fake_stream(monkeypatch, {"model-a": StatusError(403), "model-b": ['{"x": 1}']})
    with pytest.raises(RuntimeError):
        asyncio.run(client.generate_json(prompt="read"))
    assert calls == ["model-a"]
