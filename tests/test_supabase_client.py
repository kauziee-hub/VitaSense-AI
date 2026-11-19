import pytest

import db.supabase_client as supabase_client


def test_get_supabase_requires_url_and_service_role_key(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.setattr(supabase_client, "load_dotenv", lambda: None)

    with pytest.raises(RuntimeError, match="SUPABASE_URL"):
        supabase_client.get_supabase()


def test_get_supabase_uses_environment_values(monkeypatch):
    created = {}

    def fake_create_client(url, key):
        created["url"] = url
        created["key"] = key
        return object()

    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key")
    monkeypatch.setattr(supabase_client, "create_client", fake_create_client)

    client = supabase_client.get_supabase()

    assert client is not None
    assert created == {
        "url": "https://example.supabase.co",
        "key": "service-role-key",
    }


def test_client_is_reused_and_unreachable_database_is_skipped(monkeypatch):
    import asyncio

    from db import user_context_loader

    calls = {"create": 0, "query": 0}

    def fake_create_client(url, key):
        calls["create"] += 1
        return object()

    monkeypatch.setenv("SUPABASE_URL", "https://gone.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "key")
    monkeypatch.setattr(supabase_client, "create_client", fake_create_client)
    assert supabase_client.get_supabase() is supabase_client.get_supabase()
    assert calls["create"] == 1

    class Query:
        def execute(self):
            calls["query"] += 1
            raise ConnectionError("[Errno 11001] getaddrinfo failed")

    async def run():
        first = await user_context_loader._execute_with_timeout(lambda: Query(), user_id=1, table_name="users")
        second = await user_context_loader._execute_with_timeout(lambda: Query(), user_id=1, table_name="users")
        return first, second

    assert asyncio.run(run()) == (None, None)
    assert calls["query"] == 1  # the second query was skipped during the cooldown
    assert supabase_client.database_marked_unreachable()
