"""Expose the skills embedded in lark-cli while the Feishu connector is active."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from ..secrets import state_dir

_TIMEOUT = 30


def feishu_skill_cache_dir() -> Path:
    return state_dir() / "connector-skills" / "feishu"


def _run(executable: str, *args: str) -> str:
    result = subprocess.run(
        [executable, "skills", *args],
        capture_output=True,
        text=True,
        timeout=_TIMEOUT,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "lark-cli skills failed").strip())
    return result.stdout


def _entries(executable: str, path: str | None = None) -> list[dict]:
    args = ["list", *( [path] if path else [] ), "--json"]
    data = json.loads(_run(executable, *args) or "{}")
    key = "skills" if path is None else "entries"
    return list(data.get(key) or [])


def ensure_feishu_skills() -> Path | None:
    """Materialize lark-cli's embedded markdown skills into a versioned cache."""
    executable = shutil.which("lark-cli")
    if not executable:
        return None
    version_result = subprocess.run(
        [executable, "--version"], capture_output=True, text=True, timeout=10
    )
    if version_result.returncode != 0:
        return None
    version = version_result.stdout.strip()
    cache = feishu_skill_cache_dir()
    marker = cache / ".lark-cli-version"
    if marker.is_file() and marker.read_text(encoding="utf-8") == version:
        return cache

    cache.parent.mkdir(parents=True, exist_ok=True)
    temp = Path(tempfile.mkdtemp(prefix="feishu-skills-", dir=cache.parent))
    try:
        for skill in _entries(executable):
            name = str(skill.get("name") or "")
            if name.startswith("lark-"):
                folder = temp / name
                folder.mkdir(parents=True, exist_ok=True)
                instructions = _run(executable, "read", name)
                instructions += (
                    "\n\n> OpenWorker：飞书技能的参考文件内嵌在 CLI 中。若上文要求读取相对路径，"
                    f"请执行 `lark-cli skills read {name}/<相对路径>` 获取内容。\n"
                )
                (folder / "SKILL.md").write_text(instructions, encoding="utf-8")
        (temp / ".lark-cli-version").write_text(version, encoding="utf-8")
        if cache.exists():
            shutil.rmtree(cache)
        temp.replace(cache)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        shutil.rmtree(temp, ignore_errors=True)
        return None
    return cache
