from coworker import skillhub
from coworker.skillhub import _strip_front_matter


def test_strip_front_matter_removes_only_leading_delimited_block():
    source = "---\nname: ima-skill\ndescription: test\n---\n\n# ima-skill\n\n正文\n---\n尾部"
    assert _strip_front_matter(source) == "# ima-skill\n\n正文\n---\n尾部"


def test_strip_front_matter_preserves_markdown_without_leading_block():
    source = "# 标题\n\n正文\n---\n下一节"
    assert _strip_front_matter(source) == source


def test_strip_front_matter_preserves_unclosed_delimiter():
    source = "---\nname: incomplete\n# 正文"
    assert _strip_front_matter(source) == source


def test_catalog_only_returns_skills_explicitly_not_requiring_api_key(monkeypatch):
    payload = {
        "code": 0,
        "data": {
            "total": 3,
            "skills": [
                {"slug": "local-tool", "name": "本地工具", "labels": {"requires_api_key": "false"}},
                {"slug": "remote-api", "name": "远程 API", "labels": {"requires_api_key": "true"}},
                {"slug": "unknown", "name": "未标记技能"},
            ],
        },
    }
    monkeypatch.setattr(skillhub, "_get", lambda path, params=None: payload)
    skillhub._cache.clear()

    result = skillhub.skillhub_skills(page=9876, page_size=3)

    assert result["ok"] is True
    assert [row["slug"] for row in result["skills"]] == ["local-tool"]
