"""预览样例图：CDN URL 解析与下载，保证 Pandoc / docx-preview 一定能嵌入图片。"""

from __future__ import annotations

import json
import os
import re
import shutil
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CONFIG_PATH = ROOT / "config" / "preview-cdn.json"

_IMG_MD_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")


def load_cdn_config() -> dict:
    base = os.environ.get("WORDEDITOR_PREVIEW_CDN", "").strip().rstrip("/")
    if CONFIG_PATH.is_file():
        with CONFIG_PATH.open(encoding="utf-8") as f:
            cfg = json.load(f)
    else:
        cfg = {"cdn_base": "", "images": {}}
    if base:
        cfg["cdn_base"] = base
    return cfg


def cdn_url(rel_path: str, cfg: dict | None = None) -> str:
    c = cfg or load_cdn_config()
    base = (c.get("cdn_base") or "").rstrip("/")
    rel = rel_path.lstrip("/")
    return f"{base}/{rel}" if base else rel


def default_preview_image_urls(cfg: dict | None = None) -> dict[str, str]:
    c = cfg or load_cdn_config()
    out: dict[str, str] = {}
    for name, rel in (c.get("images") or {}).items():
        out[name] = cdn_url(rel, c)
    return out


def _local_fallback(rel: str) -> Path | None:
    p = ROOT / rel.lstrip("/")
    return p if p.is_file() else None


def _download(url: str, dest: Path, timeout: float = 25.0) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "wordEditor-preview/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            dest.write_bytes(resp.read())
        return dest.is_file() and dest.stat().st_size > 0
    except (urllib.error.URLError, OSError, TimeoutError):
        return False


def materialize_markdown_images(md_text: str, work_dir: Path) -> str:
    """
    将 Markdown 中的图片 URL 下载到 work_dir/preview-media/，
    并改写为相对路径；CDN 失败时回退到仓库内 input/images/。
    """
    media_dir = work_dir / "preview-media"
    media_dir.mkdir(parents=True, exist_ok=True)
    cfg = load_cdn_config()

    def replace(match: re.Match[str]) -> str:
        alt, target = match.group(1), match.group(2).strip()
        if not target or target.startswith("data:"):
            return match.group(0)

        local_path: Path | None = None
        if target.startswith(("http://", "https://")):
            name = Path(target.split("?")[0]).name or "image.png"
            dest = media_dir / name
            if _download(target, dest):
                local_path = dest
            else:
                for rel in (cfg.get("images") or {}).values():
                    if rel.endswith(name) or name in rel:
                        fb = _local_fallback(rel)
                        if fb:
                            shutil.copy2(fb, dest)
                            local_path = dest
                            break
        else:
            fb = _local_fallback(target)
            if fb:
                dest = media_dir / fb.name
                shutil.copy2(fb, dest)
                local_path = dest

        if local_path is None:
            return match.group(0)
        rel = os.path.relpath(local_path, work_dir).replace("\\", "/")
        return f"![{alt}]({rel})"

    return _IMG_MD_RE.sub(replace, md_text)
