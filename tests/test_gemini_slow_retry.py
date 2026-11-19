import asyncio

import gemini_client
from gemini_client import GeminiClient


class StatusError(Exception):
    def __init__(self, code):
        super().__init__(f"status {code}")
        self.code = code


def _client(monkeypatch, outcomes):
    """outcomes: model -> list of per-call results (Exception to raise, or list of text chunks)."""
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(gemini_client, "load_dotenv", lambda: None)
    client = GeminiClient()
    client._models = list(outcomes)
    calls = []

    async def fake_stream(*, model, contents, config):
        calls.append(model)
        outcome = outcomes[model].pop(0)
        if isinstance(outcome, Exception):
            raise outcome

        async def gen():
            for text in outcome:
                yield type("Chunk", (), {"text": text})()

        return gen()

    monkeypatch.setattr(client._client.aio.models, "generate_content_stream", fake_stream)
    return client, calls


async def _collect(client):
    stream = await client.chat([{"role": "user", "content": "hi"}])
    return "".join([part async for part in stream])


def test_slow_model_gets_one_longer_retry_when_all_fail(monkeypatch):
    client, calls = _client(
        monkeypatch,
        {
            "rate-limited": [StatusError(429)],
            "slow": [asyncio.TimeoutError(), ["Answer"]],
        },
    )

    assert asyncio.run(_collect(client)) == "Answer"
    assert calls == ["rate-limited", "slow", "slow"]


def test_no_retry_when_every_model_is_rate_limited(monkeypatch):
    client, calls = _client(monkeypatch, {"a": [StatusError(429)], "b": [StatusError(503)]})

    try:
        asyncio.run(_collect(client))
    except RuntimeError:
        pass
    else:
        raise AssertionError("expected RuntimeError")
    assert calls == ["a", "b"]
