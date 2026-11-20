import sqlite3

from fastapi.testclient import TestClient

import main
from collect.store import CollectedStore


def _offline(monkeypatch, tmp_path):
    store = CollectedStore(tmp_path / "local.db")
    monkeypatch.setattr(main, "get_collected_store", lambda: store)
    monkeypatch.setattr(main, "database_marked_unreachable", lambda: True)
    return store


def test_create_update_and_list_body_sex_offline(monkeypatch, tmp_path):
    _offline(monkeypatch, tmp_path)
    with TestClient(main.app) as client:
        created = client.post("/api/v1/users", json={"name": "Asha", "biological_sex": "female"}).json()
        assert created["biological_sex"] == "female"

        updated = client.put(f"/api/v1/users/{created['id']}", json={"biological_sex": "male"})
        assert updated.status_code == 200 and updated.json()["biological_sex"] == "male"

        listed = {u["id"]: u for u in client.get("/api/v1/users").json()["users"]}
        assert listed[created["id"]]["biological_sex"] == "male"

        assert client.put("/api/v1/users/999999", json={"biological_sex": "male"}).status_code == 404
        assert client.put(f"/api/v1/users/{created['id']}", json={"biological_sex": "other"}).status_code == 422


def test_old_local_database_gains_the_column(tmp_path):
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE local_users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, user_code TEXT NOT NULL, created_at TEXT NOT NULL)")
    conn.execute("INSERT INTO local_users VALUES (1000, 'Old', 'old', '2026-01-01')")
    conn.commit()
    conn.close()

    store = CollectedStore(path)
    assert store.list_users() == [{"id": 1000, "name": "Old", "user_code": "old", "biological_sex": None}]
    assert store.update_user(1000, {"biological_sex": "female"})["biological_sex"] == "female"
