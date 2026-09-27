"""
接口权限守卫 —— 与 services/api-node/src/http/guard.ts 同口径，两张表必须一起改。

分级：
  公开    ：健康检查、工具探测、接口契约（/openapi.json、/docs）
  登录即可：模板列表 / 参考样式 / 导出 / 导入 / 样式预览 / 文档读取
  制作员  ：PUT /api/file —— 写仓库就是改模板、styles.yaml、lua 过滤器

用户来源：Bearer token → AuthCenter /auth-center/profile（带 5 分钟缓存）。
关闭：WORDEDITOR_AUTH=off，仅供本地离线回归；服务器上不要开。
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any

AUTH_CENTER_URL = os.environ.get("AUTH_CENTER_URL", "http://100.98.118.42:8085")
WORKER_ROLE_CODES = ("doc-worker", "admin", "SUPER_ADMIN")

PUBLIC_ROUTES = {
    ("GET", "/"),
    ("GET", "/api/health"),
    ("GET", "/api/tools"),
    ("GET", "/openapi.json"),
    ("GET", "/docs"),
}
WORKER_ROUTES = {("PUT", "/api/file")}

CACHE_TTL_SECONDS = 300
_cache: dict[str, tuple[dict[str, Any], float]] = {}


def auth_enabled() -> bool:
    return os.environ.get("WORDEDITOR_AUTH", "on").strip().lower() != "off"


def _profile(token: str) -> dict[str, Any] | None:
    hit = _cache.get(token)
    if hit and hit[1] > time.time():
        return hit[0]
    req = urllib.request.Request(
        f"{AUTH_CENTER_URL}/auth-center/profile",
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError):
        return None
    inner = payload.get("data") if isinstance(payload, dict) else None
    profile = (inner or {}).get("data") if isinstance(inner, dict) else None
    if not isinstance(profile, dict) or not profile.get("id"):
        return None
    user = {
        "userId": int(profile["id"]),
        "username": str(profile.get("username") or ""),
        "roleCodes": [str(r.get("code")) for r in (profile.get("roles") or []) if isinstance(r, dict)],
    }
    _cache[token] = (user, time.time() + CACHE_TTL_SECONDS)
    return user


def is_worker(user: dict[str, Any]) -> bool:
    return any(code in WORKER_ROLE_CODES for code in user.get("roleCodes") or [])


def check(method: str, path: str, authorization: str | None) -> tuple[dict[str, Any] | None, tuple[int, str] | None]:
    """返回 (用户, 错误)。无错误时错误位为 None；公开路由用户位为 None。"""
    if not auth_enabled() or (method, path) in PUBLIC_ROUTES:
        return None, None

    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token:
        return None, (401, "未登录")
    user = _profile(token)
    if not user:
        return None, (401, "登录态无效，请重新登录")
    if (method, path) in WORKER_ROUTES and not is_worker(user):
        return None, (403, "需要制作员权限（doc-worker）")
    return user, None


# ---------------------------------------------------------------- 产物归属

_job_owners: dict[str, tuple[int, float]] = {}
OWNER_TTL_SECONDS = max(int(os.environ.get("WORDEDITOR_JOB_TTL_MINUTES", "360") or 360), 60) * 60


def remember_job_owner(job_id: str, user_id: int) -> None:
    now = time.time()
    for key, (_, at) in list(_job_owners.items()):
        if now - at > OWNER_TTL_SECONDS:
            _job_owners.pop(key, None)
    _job_owners[job_id] = (user_id, now)


def job_owner_of(job_id: str) -> int | None:
    hit = _job_owners.get(job_id)
    return hit[0] if hit else None
