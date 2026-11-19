import os
import tempfile

import pytest

# Records live in a local SQLite file; keep test runs out of the real one.
os.environ["VITASENSE_DATA_DIR"] = tempfile.mkdtemp(prefix="vitasense-test-")


@pytest.fixture(autouse=True)
def _isolate_ai_provider_env(monkeypatch):
    """The local .env may hold a real GEMINI_API_KEY; tests must never call a live model."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_MAPS_API_KEY", raising=False)


@pytest.fixture(autouse=True)
def _fresh_database_state():
    """The unreachable-database cooldown is process-wide; don't let one test's failures leak into the next."""
    from db import supabase_client

    supabase_client.reset_unreachable()
    supabase_client._clients.clear()
    yield
    supabase_client.reset_unreachable()
