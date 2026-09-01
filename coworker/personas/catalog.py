"""Read-only WorkBuddy expert catalogue used for lazy installation."""

from __future__ import annotations

import json
import re
import time
from urllib.request import Request, urlopen

CATALOG_URL = (
    "https://raw.githubusercontent.com/infometa/workbuddyskills/"
    "main/experts/expert_center.json"
)
EXPERT_TREE_URL = "https://github.com/infometa/workbuddyskills/tree/main/experts/{plugin}"
EXPERT_RAW_URL = "https://raw.githubusercontent.com/infometa/workbuddyskills/refs/heads/main/experts/{agent}"
_cache: tuple[float, list[dict]] | None = None
_categories: list[dict] = []


def _localized(value) -> str:
    if isinstance(value, dict):
        value = value.get("zh") or value.get("zh-CN") or value.get("en")
    return value.strip() if isinstance(value, str) else ""


def workbuddy_catalog(*, max_age: float = 3600) -> list[dict]:
    """Fetch metadata only. Expert bundles are downloaded later when summoned."""
    global _cache, _categories
    now = time.monotonic()
    if _cache and now - _cache[0] < max_age:
        return _cache[1]
    req = Request(CATALOG_URL, headers={"User-Agent": "OpenWorker/desktop"})
    with urlopen(req, timeout=15) as response:
        body = json.load(response)
    _categories = [
        {
            "id": str(raw.get("id", "")),
            "name": _localized(raw.get("name")),
            "description": _localized(raw.get("description")),
        }
        for raw in body.get("categories", [])
        if raw.get("id") and _localized(raw.get("name"))
    ]
    experts = []
    for raw in body.get("experts", []):
        # The catalogue mirrors .codebuddy-plugin/plugin.json. Teams are intentionally
        # excluded until OpenWorker supports WorkBuddy multi-agent packages.
        if raw.get("expertType") != "agent":
            continue
        plugin = str(raw.get("plugin", "")).strip()
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,60}", plugin):
            continue
        agent_name = str(raw.get("agentName") or plugin)
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,60}", agent_name):
            agent_name = plugin
        experts.append(
            {
                "id": f"wb-{plugin}",
                "plugin": plugin,
                "agent_name": agent_name,
                "name": _localized(raw.get("profession"))
                or _localized(raw.get("displayName"))
                or plugin,
                "display_name": _localized(raw.get("displayName")),
                "description": _localized(raw.get("description")),
                "tags": [_localized(tag) for tag in raw.get("tags", []) if _localized(tag)],
                "quick_prompts": [
                    _localized(prompt)
                    for prompt in raw.get("quickPrompts", [])
                    if _localized(prompt)
                ][:6],
                "category": str(raw.get("categoryId", "")),
                "source": EXPERT_TREE_URL.format(plugin=agent_name),
                "avatar": str(raw.get("avatar") or ""),
            }
        )
        expert = experts[-1]
        agent = expert["agent_name"]
        avatar = expert["avatar"]
        expert["avatar_url"] = EXPERT_RAW_URL.format(agent=agent) + (
            avatar if avatar.startswith("/") else f"/{avatar}"
        ) if avatar else ""
        expert["fallback_avatar_url"] = (
            EXPERT_RAW_URL.format(agent=agent) + "/avatars/expert.png"
        )
    _cache = (now, experts)
    return experts


def workbuddy_categories() -> list[dict]:
    if not _cache:
        workbuddy_catalog()
    return _categories
