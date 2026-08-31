"""WorkBuddy data conversion, persistence and fail-closed import boundaries."""
import io
import json
import shutil
import stat
import zipfile

import pytest

from coworker.personas.manifest import ManifestError
from coworker.personas.registry import PersonaRegistry
from coworker.personas.workbuddy import PLUGIN_FILE, github_source
from coworker.skills.base import SkillLoader


def bundle(tmp_path, **overrides):
    root = tmp_path / "expert"
    (root / ".codebuddy-plugin").mkdir(parents=True)
    (root / "agents").mkdir()
    (root / "agents/reviewer.md").write_text(
        "---\nname: reviewer\ntools: [shell]\nmaxTurns: 99\n---\n# 审查专家\n审查变更并说明风险。\n",
        encoding="utf-8",
    )
    skill = root / "skills/review"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text(
        "---\nname: review\ndescription: 审查代码\n---\n指出实际缺陷。\n", encoding="utf-8"
    )
    (skill / "checklist.txt").write_text("boundary cases", encoding="utf-8")
    (root / "license").mkdir()
    (root / "license/upstream.LICENSE").write_text("upstream attribution", encoding="utf-8")
    plugin = dict(name="reviewer", version="1.0.0", expertType="agent",
                  agents=["./agents/reviewer.md"], skills=["./skills/review"],
                  profession={"zh": "代码审查专家", "en": "Reviewer"}, categoryId="02-Engineering",
                  quickPrompts=[{"zh": "检查当前改动", "en": "Review changes"}])
    plugin.update(overrides)
    (root / PLUGIN_FILE).write_text(json.dumps(plugin), encoding="utf-8")
    return root


def registry(tmp_path):
    return PersonaRegistry(state_path=tmp_path / "state/personas.json")


def test_import_persists_prompt_skills_and_attribution_with_host_permissions(tmp_path):
    reg = registry(tmp_path)
    src = bundle(tmp_path)
    summary = reg.install_from_dir(src)[0]
    assert summary["name"] == "代码审查专家"
    assert summary["import_notes"] and summary["recommended_mode"] == "interactive"
    assert summary["connectors"] == [] and summary["mcp"] == []
    assert not reg.is_enabled("wb-reviewer") and not reg.is_surfaced("wb-reviewer")
    reg.set_enabled("wb-reviewer", True)
    shutil.rmtree(src)
    reg = registry(tmp_path)
    entry = reg.get("wb-reviewer")
    m = entry.manifest
    assert reg.is_enabled(entry.id) and reg.is_surfaced(entry.id)
    assert m.source_format == "workbuddy" and m.quick_prompts == ["检查当前改动"]
    assert "审查变更并说明风险。" in m.system_prompt
    assert set(m.tools) == {"code_files", "search", "todo", "git"}
    assert not m.scheduling and not m.subagents and not m.messaging and not m.connectors
    assert m.team is None and m.requires_folder
    snap = reg.installed_dir / entry.id
    loader = SkillLoader([snap / "skills"])
    assert loader.names() == ["review"]
    assert "指出实际缺陷" in loader.get("review").instructions
    assert (snap / "attribution/license/upstream.LICENSE").read_text() == "upstream attribution"
    assert (snap / "skills/review/checklist.txt").is_file()
    assert next(r for r in reg.list_all() if r["id"] == entry.id)["quick_prompts"] == ["检查当前改动"]


@pytest.mark.parametrize("change", [
    {"expertType": "team"}, {"agents": ["a.md", "b.md"]},
    {"hooks": {"SessionStart": "do something"}}, {"agents": ["../outside.md"]},
    {"skills": ["../outside"]}, {"skills": ["skills/missing"]},
    {"name": "../../escape"},
])
def test_unsupported_or_unsafe_bundle_does_not_install(tmp_path, change):
    reg = registry(tmp_path)
    before = reg.ids()
    with pytest.raises((ManifestError, FileNotFoundError)):
        reg.install_from_dir(bundle(tmp_path, **change))
    assert reg.ids() == before
    assert not reg.state_path.exists()


def test_symlink_rejected(tmp_path):
    src = bundle(tmp_path)
    (src / "linked").symlink_to(tmp_path)
    with pytest.raises(ManifestError, match="符号链接"):
        registry(tmp_path).install_from_dir(src)


def test_hooks_directory_rejected_even_if_undeclared(tmp_path):
    src = bundle(tmp_path)
    (src / "hooks").mkdir()
    with pytest.raises(ManifestError, match="Hooks"):
        registry(tmp_path).install_from_dir(src)


def test_wrapped_zip_and_export_roundtrip(tmp_path):
    src = bundle(tmp_path)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        archive.writestr("README.md", "wrapper readme is not a persona")
        for p in src.rglob("*"):
            if p.is_file():
                archive.write(p, "expert/" + p.relative_to(src).as_posix())
    reg = registry(tmp_path)
    reg.install_from_zip(buf.getvalue())
    exported = reg.export_persona("wb-reviewer", tmp_path)
    assert exported["ok"]
    from pathlib import Path
    data = Path(exported["path"]).read_bytes()
    reg.uninstall("wb-reviewer")
    reg.install_from_zip(data)
    assert reg.get("wb-reviewer").manifest.source_format == "workbuddy"
    assert (reg.installed_dir / "wb-reviewer/attribution/original-plugin.json").is_file()


@pytest.mark.parametrize("name,mode", [("../escape", 0), ("/tmp/escape", 0),
                                        ("C:\\escape", 0), ("link", stat.S_IFLNK | 0o777)])
def test_unsafe_archives_rejected(tmp_path, name, mode):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        info = zipfile.ZipInfo(name)
        info.external_attr = mode << 16
        archive.writestr(info, "bad")
    with pytest.raises(FileNotFoundError, match="unsafe path"):
        registry(tmp_path).install_from_zip(buf.getvalue())


def test_git_subdirectory_import_and_catalogue_rejection(tmp_path):
    src = bundle(tmp_path)
    url = "https://github.com/example/workbuddyskills/tree/main/experts/reviewer"
    assert github_source(url) == ("https://github.com/example/workbuddyskills.git", "main", "experts/reviewer")
    def clone(repo, dest):
        assert repo == "https://github.com/example/workbuddyskills.git"
        shutil.copytree(src, dest / "experts/reviewer")
    reg = registry(tmp_path)
    assert reg.install_from_git(url, cache_base=tmp_path / "cache", clone=clone)[0]["source"] == url
    (tmp_path / "expert_center.json").write_text("{}")
    with pytest.raises(ValueError, match="专家合集"):
        reg.install_from_dir(tmp_path)


def test_update_removes_old_skills(tmp_path):
    src = bundle(tmp_path)
    reg = registry(tmp_path)
    reg.install_from_dir(src)
    reg.set_enabled("wb-reviewer", True)
    plugin = json.loads((src / PLUGIN_FILE).read_text())
    plugin["skills"] = []
    (src / PLUGIN_FILE).write_text(json.dumps(plugin))
    reg.install_from_dir(src)
    assert not (reg.installed_dir / "wb-reviewer/skills").exists()
    assert reg.is_enabled("wb-reviewer")


def test_workbuddy_cannot_inherit_configured_mcp_servers(tmp_path, monkeypatch):
    from test_persona_skills import _mgr, _session
    mgr = _mgr(tmp_path, monkeypatch)
    mgr.personas.install_from_dir(bundle(tmp_path))
    mgr.personas.set_enabled("wb-reviewer", True)
    _session(mgr, "review", "wb-reviewer")
    assert mgr.persona_mcp_scope("wb-reviewer") == set()
    assert "review" in mgr.effective_skill_names("review")
