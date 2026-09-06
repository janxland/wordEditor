#!/usr/bin/env python3
"""wordEditor 直连构建层 —— CLI 与 MCP 共用的最小实现。

工作区（Workspace）约定：
  工作区 = 输入 Markdown 所在的目录。
  - MD 中的相对图片路径（images/、media/、charts/）以工作区为根解析；
  - 导出的 docx 默认回写到工作区（即与 MD 同目录）；
  - 除非显式指定 --output / output_path，不会向工作区外写任何文件。

不依赖 web/API，直接调用 pipeline/build.py（Pandoc + OOXML 后处理）。
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]           # janxland/wordEditor
PIPELINE = Path(__file__).resolve().parent / "pipeline"
CACHE = ROOT / ".cache" / "wordeditor-direct"
CONFIG = ROOT / "config" / "templates.json"
IMAGE_DIRS = ("images", "media", "charts")           # 工作区内会被一起带走的标准资源目录


def list_templates() -> list[dict]:
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    out = []
    for t in cfg.get("templates", []):
        out.append({
            "id": t["id"],
            "name": t.get("name", t["id"]),
            "default": t["id"] == cfg.get("default_template"),
            "note": t.get("note", ""),
        })
    return out


def _valid_template(tid: str) -> str:
    ids = {t["id"] for t in list_templates()}
    if tid not in ids:
        raise SystemExit(f"未知模板 '{tid}'。可用: {', '.join(sorted(ids))}")
    return tid


def resolve_md(path: str | Path) -> Path:
    """入参可以是 md 文件或工作区目录；目录时优先取与目录同名的 md。"""
    p = Path(path).expanduser().resolve()
    if p.is_file() and p.suffix.lower() == ".md":
        return p
    if p.is_dir():
        named = p / f"{p.name}.md"
        if named.is_file():
            return named
        mds = [m for m in sorted(p.glob("*.md")) if m.name.lower() != "readme.md"]
        if len(mds) == 1:
            return mds[0]
        if mds:  # 多个时取同名优先，否则取最大的
            named = [m for m in mds if m.stem == p.name]
            if named:
                return named[0]
            raise SystemExit(
                "工作区内有多个 md，请直接指定文件：" + "、".join(m.name for m in mds))
        raise SystemExit(f"工作区 {p} 内没有 .md 文件")
    raise SystemExit(f"路径不存在或不是 md: {p}")


def build_to_workspace(
    md_path: str | Path,
    template_id: str = "hutb-guanke",
    output_path: str | Path | None = None,
    keep_job: bool = False,
) -> Path:
    """把一份 MD（含工作区图片）按模板导出为 docx，默认回写工作区。"""
    md = resolve_md(md_path)
    template_id = _valid_template(template_id)
    workspace = md.parent                                    # 工作区 = MD 所在目录

    out = Path(output_path).expanduser().resolve() if output_path \
        else workspace / f"{md.stem}.docx"                   # 默认产物回写工作区
    out.parent.mkdir(parents=True, exist_ok=True)

    CACHE.mkdir(parents=True, exist_ok=True)
    job = CACHE / uuid.uuid4().hex
    job.mkdir()
    try:
        shutil.copy2(md, job / md.name)                      # 保持相对路径结构
        for sub in IMAGE_DIRS:
            src = workspace / sub
            if src.is_dir():
                shutil.copytree(src, job / sub)
        cmd = [
            sys.executable, str(PIPELINE / "build.py"),
            "-i", str(job / md.name),
            "-o", str(job / "output.docx"),
            "-t", template_id,
        ]
        env = {**__import__("os").environ, "PYTHONIOENCODING": "utf-8"}
        proc = subprocess.run(
            cmd, cwd=str(ROOT), env=env,
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        if proc.returncode != 0:
            raise SystemExit(
                f"构建失败 (exit {proc.returncode})\n{proc.stdout[-2000:]}\n{proc.stderr[-2000:]}")
        produced = job / "output.docx"
        if not produced.is_file():
            raise SystemExit("构建未产出 docx")
        shutil.copy2(produced, out)
    finally:
        if not keep_job:
            shutil.rmtree(job, ignore_errors=True)

    print(f"工作区: {workspace}")
    print(f"模板:   {template_id}")
    print(f"输入:   {md}")
    print(f"产物:   {out}")
    return out


if __name__ == "__main__":
    build_to_workspace(*sys.argv[1:])
