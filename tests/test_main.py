from fastapi.testclient import TestClient

import main


class FakeGrokClient:
    async def verify_models(self):
        return ["grok-3-mini"]

    async def health_check(self):
        return True

    async def close(self):
        return None


def test_app_boots_and_health_responds(monkeypatch):
    monkeypatch.setenv("GROK_API_KEY", "test-key-for-lifespan")
    monkeypatch.setattr(main, "GrokClient", FakeGrokClient)

    with TestClient(main.app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["ai"] is True
    assert response.json()["ai_provider"] == "grok"
    assert isinstance(response.json()["database"], bool)


class FailingVerifyClient(FakeGrokClient):
    async def verify_models(self):
        raise RuntimeError("credits exhausted")

    async def health_check(self):
        return False


def test_app_still_boots_when_ai_provider_fails(monkeypatch):
    monkeypatch.setenv("GROK_API_KEY", "test-key-for-lifespan")
    monkeypatch.setattr(main, "GrokClient", FailingVerifyClient)

    with TestClient(main.app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["ai"] is False


def test_gemini_is_preferred_when_both_keys_are_set(monkeypatch):
    monkeypatch.setenv("GROK_API_KEY", "grok-key")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.setattr(main, "GeminiClient", FakeGrokClient)
    monkeypatch.setattr(main, "GrokClient", FailingVerifyClient)

    with TestClient(main.app) as client:
        response = client.get("/health")

    assert response.json()["ai_provider"] == "gemini"
    assert response.json()["ai"] is True
