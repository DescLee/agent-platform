import io
import json

from coworker.personas import catalog


def test_catalog_exposes_agents_only_and_maps_lazy_install_source(monkeypatch):
    payload = {
        "categories": [
            {"id": "06-ContentCreative", "name": {"zh": "内容创作"}, "description": {"zh": "内容专家"}}
        ],
        "experts": [
            {
                "plugin": "writer",
                "agentName": "writer-agent",
                "avatar": "/avatars/Writer.png",
                "expertType": "agent",
                "profession": {"zh": "写作专家", "en": "Writer"},
                "displayName": {"zh": "小文"},
                "description": {"zh": "撰写内容"},
                "tags": [{"zh": "写作"}],
                "quickPrompts": [{"zh": "写一篇文章"}],
                "categoryId": "06-ContentCreative",
            },
            {"plugin": "writer-team", "expertType": "team", "profession": {"zh": "写作团队"}},
        ]
    }

    class Response(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

    monkeypatch.setattr(catalog, "_cache", None)
    monkeypatch.setattr(catalog, "urlopen", lambda *_args, **_kwargs: Response(json.dumps(payload).encode()))
    experts = catalog.workbuddy_catalog()

    assert [expert["id"] for expert in experts] == ["wb-writer"]
    assert experts[0]["name"] == "写作专家"
    assert experts[0]["source"].endswith("/experts/writer-agent")
    assert experts[0]["avatar_url"].endswith("/experts/writer-agent/avatars/Writer.png")
    assert experts[0]["fallback_avatar_url"].endswith("/experts/writer-agent/avatars/expert.png")
    assert catalog.workbuddy_categories() == [
        {"id": "06-ContentCreative", "name": "内容创作", "description": "内容专家"}
    ]
