"""Tests for the model API-key settings path (Tauri desktop Phase 2).

A Tauri-launched sidecar doesn't inherit the shell env, so the key may live only in the
SecretStore. These cover: the env→store resolver, the status shape (never leaks the key),
and the REST round-trip. No network, no model calls.
"""

from __future__ import annotations

from pathlib import Path

from coworker.providers import resolve_api_key
from coworker.secrets import SecretStore


def test_removed_custom_provider_falls_back_and_persists(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from coworker.server import create_app
    from coworker.server.manager import SessionManager

    monkeypatch.setenv("COWORKER_STATE_DIR", str(tmp_path / "state"))
    manager = SessionManager(data_dir=tmp_path / "data")
    # Exercise real profile removal, but make availability deterministic and offline.
    monkeypatch.setattr(manager, "_provider_configured", lambda name: bool(manager.secrets.get(f"provider:{name}")))
    monkeypatch.setattr(manager, "_ollama_alive", lambda: False)
    for name in ("custom-old", "custom-passion"):
        manager.secrets.put(f"provider:{name}", {"api_key": "test-only", "base_url": "https://example.invalid/v1"})
    manager.secrets.put("provider:custom_index", {"ids": ["custom-old", "custom-passion"]})
    manager._prefs["models"] = ["custom-old:old-model", "custom-passion:new-model"]
    manager.model = "custom-old:old-model"
    manager._prefs["default_model"] = manager.model
    client = TestClient(create_app(manager))
    assert client.delete("/v1/providers/custom-old").json()["ok"]
    result = client.get("/v1/settings").json()
    assert result["model_ready"]
    assert result["model"] == "custom-passion:new-model"
    assert result["models"] == ["custom-passion:new-model"]
    assert SessionManager(data_dir=tmp_path / "data").model == result["model"]


def test_settings_recovers_stale_default_but_keeps_valid_selection(tmp_path, monkeypatch):
    from coworker.server.manager import SessionManager

    monkeypatch.setenv("COWORKER_STATE_DIR", str(tmp_path / "state"))
    manager = SessionManager(data_dir=tmp_path / "data")
    monkeypatch.setattr(manager, "_ollama_alive", lambda: False)
    monkeypatch.setattr(manager, "_curated_models", lambda: [manager.model, "deepseek:deepseek-chat", "deepseek:deepseek-reasoner"])
    monkeypatch.setattr(manager, "_provider_configured", lambda name: name == "deepseek")
    manager.model = "gpt-5.6-sol"
    assert manager.get_settings()["model"] == "deepseek:deepseek-chat"
    manager.model = "deepseek:deepseek-reasoner"
    assert manager.get_settings()["model"] == "deepseek:deepseek-reasoner"
    monkeypatch.setattr(manager, "_provider_configured", lambda name: False)
    assert not manager.get_settings()["model_ready"]
    assert manager.model == "deepseek:deepseek-reasoner"


def test_resolve_api_key_prefers_env(monkeypatch, tmp_path):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-env-123")
    secrets = SecretStore(path=tmp_path / "secrets.json")
    secrets.put("provider:openai", {"type": "api_key", "api_key": "sk-store-999"})
    assert resolve_api_key(secrets) == "sk-env-123"


def test_resolve_api_key_falls_back_to_store(monkeypatch, tmp_path):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    secrets = SecretStore(path=tmp_path / "secrets.json")
    assert resolve_api_key(secrets) is None
    secrets.put("provider:openai", {"type": "api_key", "api_key": "sk-store-999"})
    assert resolve_api_key(secrets) == "sk-store-999"


def test_settings_rest_roundtrip(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from coworker.server.app import create_app
    from coworker.server.manager import SessionManager

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("COWORKER_STATE_DIR", str(tmp_path / "state"))
    manager = SessionManager(data_dir=tmp_path / "data")
    client = TestClient(create_app(manager))

    before = client.get("/v1/settings").json()
    assert (
        before["has_key"] is False
        and before["source"] is None
        and before["provider"] == "openai"
    )
    assert before["onboarded"] is False and before["model"] in before["models"]

    set_resp = client.post(
        "/v1/settings/model-key", json={"api_key": "sk-secret-xyz"}
    ).json()
    assert (
        set_resp["ok"] is True
        and set_resp["has_key"] is True
        and set_resp["source"] == "store"
    )

    after = client.get("/v1/settings").json()
    assert after["has_key"] is True
    # the key value is never returned by either endpoint
    assert "sk-secret-xyz" not in str(set_resp) and "api_key" not in after

    # empty key is rejected
    assert (
        client.post("/v1/settings/model-key", json={"api_key": "  "}).json()["ok"]
        is False
    )


def test_default_model_and_onboarding_persist(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from coworker.server.app import create_app
    from coworker.server.manager import SessionManager

    monkeypatch.setenv("COWORKER_STATE_DIR", str(tmp_path / "state"))
    data_dir = tmp_path / "data"
    client = TestClient(create_app(SessionManager(data_dir=data_dir)))

    # set a default model + mark onboarded
    assert (
        client.post("/v1/settings/default-model", json={"model": "gpt-4o"}).json()[
            "model"
        ]
        == "gpt-4o"
    )
    assert (
        client.post("/v1/settings/onboarded", json={"value": True}).json()["onboarded"]
        is True
    )
    assert (
        client.post("/v1/settings/default-model", json={"model": " "}).json()["ok"]
        is False
    )

    # a fresh manager over the same data dir restores both from prefs.json
    reborn = SessionManager(data_dir=data_dir)
    assert reborn.model == "gpt-4o"
    s = reborn.get_settings()
    assert s["onboarded"] is True and s["model"] == "gpt-4o"


def test_home_model_default_applies_to_new_sessions_but_not_history(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from coworker.server import create_app
    from coworker.server.manager import SessionManager

    monkeypatch.setenv("COWORKER_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setattr(SessionManager, "_provider_configured", lambda self, name: name == "openai")
    monkeypatch.setattr(SessionManager, "_ollama_alive", lambda self: False)
    data = tmp_path / "data"
    manager = SessionManager(data_dir=data)
    existing = manager.get_engine("history", workspace=tmp_path)
    old_model = existing.model
    existing.messages.append({"role": "user", "content": "An existing conversation"})
    manager.save("history", existing)

    client = TestClient(create_app(manager))
    result = client.post("/v1/settings/default-model", json={"model": "gpt-5.5"}).json()
    assert result["ok"] and result["model"] == "gpt-5.5"
    assert manager.get_engine("new-home", workspace=tmp_path).model == "gpt-5.5"
    assert existing.model == old_model

    restarted = SessionManager(data_dir=data)
    assert restarted.get_engine("after-restart", workspace=tmp_path).model == "gpt-5.5"
    assert restarted.get_engine("history", workspace=tmp_path).model == old_model


def test_nav_layout_setting_roundtrips(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from coworker.server.app import create_app
    from coworker.server.manager import SessionManager

    monkeypatch.setenv("COWORKER_STATE_DIR", str(tmp_path / "state"))
    data_dir = tmp_path / "data"
    client = TestClient(create_app(SessionManager(data_dir=data_dir)))

    # defaults to "flat"
    assert client.get("/v1/settings").json()["nav_layout"] == "flat"

    resp = client.post("/v1/settings/nav-layout", json={"nav_layout": "grouped"}).json()
    assert resp == {"ok": True, "nav_layout": "grouped"}
    assert client.get("/v1/settings").json()["nav_layout"] == "grouped"

    # unknown value falls back to flat; persists across a restart
    assert (
        client.post("/v1/settings/nav-layout", json={"nav_layout": "bogus"}).json()[
            "nav_layout"
        ]
        == "flat"
    )
    client.post("/v1/settings/nav-layout", json={"nav_layout": "grouped"})
    reborn = SessionManager(data_dir=data_dir)
    assert reborn.get_settings()["nav_layout"] == "grouped"


def test_scratch_base_setting_persists_and_drives_provisioning(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from coworker.server.app import create_app
    from coworker.server.manager import SessionManager

    monkeypatch.setenv("COWORKER_STATE_DIR", str(tmp_path / "state"))
    data_dir = tmp_path / "data"
    client = TestClient(create_app(SessionManager(data_dir=data_dir)))

    # defaults to ~/OpenWorker
    assert client.get("/v1/settings").json()["scratch_base"] == "~/OpenWorker"

    base = tmp_path / "my coworker files"
    resp = client.post("/v1/settings/scratch-base", json={"path": str(base)}).json()
    assert resp["ok"] is True and resp["scratch_base"] == str(base)
    assert base.is_dir()  # created on set
    assert (
        client.post("/v1/settings/scratch-base", json={"path": " "}).json()["ok"]
        is False
    )

    # persists across a restart and actually drives where scratch dirs are provisioned
    reborn = SessionManager(data_dir=data_dir)
    assert reborn.get_settings()["scratch_base"] == str(base)
    scratch = reborn._provision_scratch("sess-xyz")
    assert Path(scratch) == (base / "sess-xyz").resolve() and Path(scratch).is_dir()


def test_ollama_models_gated_on_liveness(tmp_path, monkeypatch):
    """`ollama:*` entries show only while a local Ollama answers — keyless must not mean
    always-present (a stray ollama:<junk> pref would otherwise render forever)."""
    from coworker.server.manager import SessionManager

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("COWORKER_STATE_DIR", str(tmp_path / "state"))
    manager = SessionManager(data_dir=tmp_path / "data")
    manager.add_model("ollama:llama3.3")

    monkeypatch.setattr(SessionManager, "_ollama_alive", lambda self: False)
    assert "ollama:llama3.3" not in manager.get_settings()["models"]

    monkeypatch.setattr(SessionManager, "_ollama_alive", lambda self: True)
    assert "ollama:llama3.3" in manager.get_settings()["models"]
