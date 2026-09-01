"""Read-only SkillHub catalog proxy with bounded inputs and short-lived caching."""

from __future__ import annotations

import re
import threading
import time
from typing import Any
from urllib.parse import urlparse

import httpx

_BASE = "https://api.skillhub.cn"
_CACHE_TTL = 300.0
_CATEGORY_TTL = 3600.0
_CATEGORY_RE = re.compile(r"^[a-z0-9-]{1,64}$")
_COORDINATE_RE = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
_MAX_SKILL_ARCHIVE = 50 * 1024 * 1024
_cache: dict[tuple[Any, ...], tuple[float, Any]] = {}
_lock = threading.Lock()


def _strip_front_matter(text: str) -> str:
    """Remove a leading YAML front matter block delimited by standalone `---` lines."""
    normalized = text.lstrip("\ufeff")
    lines = normalized.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return normalized
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            return "".join(lines[index + 1:]).lstrip("\r\n")
    return normalized


def _cached(key: tuple[Any, ...], ttl: float, load):
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    value = load()
    with _lock:
        _cache[key] = (now, value)
    return value


def _get(path: str, params: dict[str, Any] | None = None) -> Any:
    response = httpx.get(
        _BASE + path,
        params=params,
        timeout=httpx.Timeout(8.0, connect=3.0),
        follow_redirects=False,
        headers={"Accept": "application/json", "User-Agent": "OpenWorker/SkillHubCatalog"},
    )
    response.raise_for_status()
    return response.json()


def _get_text(path: str, params: dict[str, Any] | None = None) -> str:
    response = httpx.get(
        _BASE + path,
        params=params,
        timeout=httpx.Timeout(8.0, connect=3.0),
        follow_redirects=True,
        headers={"Accept": "text/plain", "User-Agent": "OpenWorker/SkillHubCatalog"},
    )
    response.raise_for_status()
    return response.text


def skillhub_categories() -> dict[str, Any]:
    def load() -> dict[str, Any]:
        payload = _get("/api/v1/categories")
        items = [
            {"key": str(item.get("key", "")), "name": str(item.get("name", ""))}
            for item in payload.get("items", [])
            if item.get("active", True) and _CATEGORY_RE.fullmatch(str(item.get("key", "")))
        ]
        return {"ok": True, "categories": items}

    try:
        return _cached(("categories",), _CATEGORY_TTL, load)
    except (httpx.HTTPError, ValueError, TypeError):
        return {"ok": False, "error": "SkillHub 分类暂时无法加载", "categories": []}


def skillhub_skills(page: int = 1, page_size: int = 24, category: str = "") -> dict[str, Any]:
    page = max(1, min(int(page), 10_000))
    page_size = max(1, min(int(page_size), 30))
    category = category.strip().lower()
    if category and not _CATEGORY_RE.fullmatch(category):
        return {"ok": False, "error": "无效的技能分类", "skills": [], "total": 0}

    def load() -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "pageSize": page_size, "sortBy": "score"}
        if category:
            params["category"] = category
        payload = _get("/api/skills", params)
        if payload.get("code") != 0:
            raise ValueError("SkillHub returned an application error")
        data = payload.get("data") or {}
        skills = []
        for item in data.get("skills") or []:
            namespace = item.get("namespace") or {}
            handle = str(namespace.get("handle", ""))
            slug = str(item.get("slug", ""))
            if not slug:
                continue
            skills.append(
                {
                    "slug": slug,
                    "name": str(item.get("name", slug)),
                    "description": str(item.get("description_zh") or item.get("description") or ""),
                    "category": str(item.get("category", "")),
                    "downloads": int(item.get("downloads") or 0),
                    "stars": int(item.get("stars") or 0),
                    "verified": bool(item.get("verified") or (item.get("publisher") or {}).get("verified")),
                    "icon_url": str(item.get("iconUrl") or ""),
                    "publisher": str((item.get("publisher") or {}).get("name") or item.get("ownerName") or handle),
                    "namespace": handle,
                    "tags": [
                        str(tag.get("name") or tag.get("key") or tag) if isinstance(tag, dict) else str(tag)
                        for tag in (item.get("tags") or item.get("subCategories") or [])
                    ],
                    "overview": str(item.get("overview_zh") or item.get("overview") or item.get("description_zh") or item.get("description") or ""),
                    "rating": float(item.get("rating") or 0),
                    "evaluation_report": str(item.get("evaluation_report_zh") or item.get("evaluation_report") or item.get("evaluationReport") or ""),
                    "url": f"https://skillhub.cn/skills/{handle}/{slug}" if handle else f"https://skillhub.cn/skills/{slug}",
                }
            )
        return {"ok": True, "skills": skills, "total": int(data.get("total") or 0), "page": page, "page_size": page_size}

    try:
        return _cached(("skills", page, page_size, category), _CACHE_TTL, load)
    except (httpx.HTTPError, ValueError, TypeError):
        return {"ok": False, "error": "SkillHub 技能暂时无法加载", "skills": [], "total": 0}


def skillhub_skill_detail(slug: str, namespace: str = "") -> dict[str, Any]:
    slug = slug.strip()
    namespace = namespace.strip()
    if not _COORDINATE_RE.fullmatch(slug) or (namespace and not _COORDINATE_RE.fullmatch(namespace)):
        return {"ok": False, "error": "无效的技能标识"}

    def load() -> dict[str, Any]:
        params = {"namespace": namespace} if namespace else None
        detail = _get(f"/api/v1/skills/{slug}", params)
        skill = detail.get("skill") or {}
        resolved_namespace = str((detail.get("namespace") or {}).get("handle") or namespace)

        stats = skill.get("stats") or {}
        subcategories = skill.get("subCategories") or []
        return {
            "ok": True,
            "skill": {
                "slug": str(skill.get("slug") or slug),
                "namespace": resolved_namespace,
                "name": str(skill.get("displayName") or skill.get("name") or slug),
                "description": str(skill.get("summary_zh") or skill.get("summary") or ""),
                "category": str(skill.get("category") or ""),
                "tags": [str(item.get("name") or item.get("key")) for item in subcategories if isinstance(item, dict)],
                "icon_url": str(skill.get("iconUrl") or ""),
                "verified": bool(skill.get("verified") or skill.get("isAuthorVerified")),
                "downloads": int(stats.get("downloads") or 0),
                "stars": int(stats.get("stars") or 0),
                "version": str((detail.get("latestVersion") or {}).get("version") or ""),
                "publisher": str((detail.get("owner") or {}).get("displayName") or resolved_namespace),
            },
        }

    try:
        return _cached(("skill-detail", slug, namespace), _CACHE_TTL, load)
    except (httpx.HTTPError, ValueError, TypeError):
        return {"ok": False, "error": "SkillHub 技能详情暂时无法加载"}


def skillhub_skill_overview(slug: str, namespace: str = "") -> dict[str, Any]:
    slug = slug.strip()
    namespace = namespace.strip()
    if not _COORDINATE_RE.fullmatch(slug) or (namespace and not _COORDINATE_RE.fullmatch(namespace)):
        return {"ok": False, "error": "无效的技能标识"}

    def load() -> dict[str, Any]:
        params: dict[str, Any] = {"path": "SKILL.md"}
        if namespace:
            params["namespace"] = namespace
        overview = _get_text(f"/api/v1/skills/{slug}/file", params)
        return {"ok": True, "overview": _strip_front_matter(overview)}

    try:
        return _cached(("skill-overview", slug, namespace), _CACHE_TTL, load)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            return {"ok": True, "overview": ""}
        return {"ok": False, "error": "SkillHub 技能概述暂时无法加载"}
    except (httpx.HTTPError, ValueError, TypeError):
        return {"ok": False, "error": "SkillHub 技能概述暂时无法加载"}


def skillhub_skill_evaluation(slug: str, namespace: str = "") -> dict[str, Any]:
    slug = slug.strip()
    namespace = namespace.strip()
    if not _COORDINATE_RE.fullmatch(slug) or (namespace and not _COORDINATE_RE.fullmatch(namespace)):
        return {"ok": False, "error": "无效的技能标识"}

    def load() -> dict[str, Any]:
        params = {"namespace": namespace} if namespace else None
        return {"ok": True, "evaluation": _get(f"/api/v1/skills/{slug}/evaluation", params)}

    try:
        return _cached(("skill-evaluation", slug, namespace), _CACHE_TTL, load)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            return {"ok": True, "evaluation": None}
        return {"ok": False, "error": "SkillHub 技能评测暂时无法加载"}
    except (httpx.HTTPError, ValueError, TypeError):
        return {"ok": False, "error": "SkillHub 技能评测暂时无法加载"}


def skillhub_skill_archive(slug: str, namespace: str = "", version: str = "") -> bytes:
    slug = slug.strip()
    namespace = namespace.strip()
    version = version.strip()
    if not _COORDINATE_RE.fullmatch(slug) or (namespace and not _COORDINATE_RE.fullmatch(namespace)):
        raise ValueError("无效的技能标识")
    params: dict[str, str] = {"slug": slug}
    if namespace:
        params["namespace"] = namespace
    if version:
        params["version"] = version
    with httpx.stream(
        "GET",
        _BASE + "/api/v1/download",
        params=params,
        timeout=httpx.Timeout(30.0, connect=5.0),
        follow_redirects=True,
        headers={"Accept": "application/zip", "User-Agent": "OpenWorker/SkillHubCatalog"},
    ) as response:
        response.raise_for_status()
        final = urlparse(str(response.url))
        host = (final.hostname or "").lower()
        if final.scheme != "https" or not (
            host == "api.skillhub.cn"
            or host.endswith(".myqcloud.com")
            or host.endswith(".tencent-cloud.com")
        ):
            raise ValueError("SkillHub 返回了不受信任的下载地址")
        size = int(response.headers.get("content-length") or 0)
        if size > _MAX_SKILL_ARCHIVE:
            raise ValueError("技能包不能超过 50 MB")
        chunks: list[bytes] = []
        total = 0
        for chunk in response.iter_bytes():
            total += len(chunk)
            if total > _MAX_SKILL_ARCHIVE:
                raise ValueError("技能包不能超过 50 MB")
            chunks.append(chunk)
        return b"".join(chunks)
