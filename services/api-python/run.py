#!/usr/bin/env python3
"""api-python 统一入口。

职责：将 Python 管线能力统一暴露在 services/api-python 下，
实际执行委托给 services/api-python/pipeline 中的脚本。

示例：
  py services/api-python/run.py build -i input/demo.md -t hutb-guanke
  py services/api-python/run.py preview-styles -t hutb-guanke -o output/preview.docx --styles templates/hutb-guanke/styles.yaml
  py services/api-python/run.py extract-docx -i input/a.docx -o output/a.md
  py services/api-python/run.py ref-styles -t hutb-guanke --json
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PIPELINE = ROOT / "services" / "api-python" / "pipeline"


def _pipeline_script(name: str) -> Path:
    p = PIPELINE / name
    if not p.is_file():
        raise SystemExit(f"找不到管线脚本: {p}")
    return p


def _forward(script_name: str, argv: list[str]) -> int:
    script = _pipeline_script(script_name)
    cmd = [sys.executable, str(script), *argv]
    return subprocess.call(cmd, cwd=str(ROOT))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="api-python 统一入口（转发 api-python/pipeline）")
    sub = ap.add_subparsers(dest="command", required=True)

    sub.add_parser("build", help="转发到 pipeline/build.py")
    sub.add_parser("preview-styles", help="转发到 pipeline/preview_styles.py")
    sub.add_parser("extract-docx", help="转发到 pipeline/extract_docx_to_md.py")
    sub.add_parser("ref-styles", help="转发到 pipeline/list_reference_styles.py")

    p_raw = sub.add_parser("run", help="直接指定 api-python/pipeline 下脚本名并转发")
    p_raw.add_argument("script", help="例如 postprocess_styles.py")

    ns, rest = ap.parse_known_args(argv)

    if ns.command == "build":
        return _forward("build.py", rest)
    if ns.command == "preview-styles":
        return _forward("preview_styles.py", rest)
    if ns.command == "extract-docx":
        return _forward("extract_docx_to_md.py", rest)
    if ns.command == "ref-styles":
        return _forward("list_reference_styles.py", rest)
    if ns.command == "run":
        return _forward(ns.script, rest)

    return 2


if __name__ == "__main__":
    raise SystemExit(main())
