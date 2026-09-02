"""Install and locate skill bundles owned by CLI connectors."""

from __future__ import annotations

import concurrent.futures
import json
import shutil
import tempfile
import time
import urllib.request
from pathlib import Path

from ..secrets import state_dir
from .feishu_skills import ensure_feishu_skills, feishu_skill_cache_dir

SKILL_CONNECTORS = ("dingtalk", "feishu", "wecom")


def _read_url(url: str) -> bytes:
    last_error: Exception | None = None
    for attempt in range(3):
        request = urllib.request.Request(url, headers={"User-Agent": "OpenWorker"})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read()
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(attempt + 1)
    assert last_error is not None
    raise last_error


def connector_skill_cache_dir(name: str) -> Path:
    if name == "feishu":
        return feishu_skill_cache_dir()
    return state_dir() / "connector-skills" / name


def _install_github_skills(name: str) -> Path:
    prefix = f"connectors/{name}/skills/"
    tree_url = "https://api.github.com/repos/DescLee/workbuddyskills/git/trees/main?recursive=1"
    tree = json.loads(_read_url(tree_url))
    paths = [
        item["path"]
        for item in tree.get("tree", [])
        if item.get("type") == "blob" and item.get("path", "").startswith(prefix)
    ]
    if not paths:
        raise RuntimeError(f"{name} skills not found in connector repository")

    def download(path: str) -> tuple[Path, bytes]:
        relative = Path(path.removeprefix(prefix))
        if not relative.parts or relative.is_absolute() or ".." in relative.parts:
            raise RuntimeError(f"unsafe skill path: {path}")
        raw_url = f"https://raw.githubusercontent.com/DescLee/workbuddyskills/main/{path}"
        return relative, _read_url(raw_url)

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        files = list(executor.map(download, paths))

    cache = connector_skill_cache_dir(name)
    cache.parent.mkdir(parents=True, exist_ok=True)
    temp = Path(tempfile.mkdtemp(prefix=f"{name}-skills-", dir=cache.parent))
    try:
        # DingTalk's connector stores one skill directly at skills/SKILL.md;
        # SkillLoader expects every skill under a named child directory.
        root = temp / name if any(rel == Path("SKILL.md") for rel, _ in files) else temp
        for relative, content in files:
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        if cache.exists():
            shutil.rmtree(cache)
        temp.replace(cache)
    except Exception:
        shutil.rmtree(temp, ignore_errors=True)
        raise
    return cache


def install_connector_skills(name: str) -> Path | None:
    """Install skills as part of the connector's explicit Install action."""
    if name == "feishu":
        return ensure_feishu_skills()
    if name in {"dingtalk", "wecom"}:
        return _install_github_skills(name)
    return None
