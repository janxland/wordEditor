#!/usr/bin/env python3
"""
Markdown → Word 一键构建（多模板）。

用法:
  python scripts/build.py                          # 默认模板，input/example.md
  python scripts/build.py -i report.md -t hutb-carbon-neutral
  python scripts/build.py --list-templates
  python scripts/setup_templates.py                # 首次：从 vendor 提取内置模板
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "templates.json"
DEFAULT_INPUT = ROOT / "input" / "example.md"
DEFAULT_OUTPUT_DIR = ROOT / "output"


def load_config() -> dict:
    with CONFIG_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def find_pandoc() -> str:
    exe = shutil.which("pandoc")
    if exe:
        return exe
    # winget 常见安装路径
    for candidate in (
        Path(r"C:\Program Files\Pandoc\pandoc.exe"),
        Path(r"C:\Users") / Path.home().name / "AppData/Local/Pandoc/pandoc.exe",
    ):
        if candidate.is_file():
            return str(candidate)
    return "pandoc"


def resolve_template(cfg: dict, template_id: str | None) -> dict:
    tid = template_id or cfg["default_template"]
    for t in cfg["templates"]:
        if t["id"] == tid:
            return t
    ids = ", ".join(t["id"] for t in cfg["templates"])
    raise SystemExit(f"未知模板 '{tid}'。可用: {ids}")


def list_templates(cfg: dict) -> None:
    print("可用模板 (--template / -t):\n")
    for t in cfg["templates"]:
        ref = ROOT / t["reference_doc"]
        ok = "✓" if ref.is_file() else "✗ 缺少 reference.docx"
        note = f"  — {t['note']}" if t.get("note") else ""
        print(f"  {t['id']:<28} {t['name']}{note}")
        print(f"    {'':28} [{ok}] {t['reference_doc']}\n")


def run_pandoc(
    pandoc: str,
    input_md: Path,
    output_docx: Path,
    reference_doc: Path,
    lua_filter: Path,
    use_html_pipe: bool,
) -> None:
    output_docx.parent.mkdir(parents=True, exist_ok=True)
    lua_arg = ["--lua-filter", str(lua_filter)] if lua_filter.is_file() else []

    if use_html_pipe:
        # 与上游 md2docx.sh 一致：经 HTML 中转以更好支持部分 HTML 标签
        cmd1 = [pandoc, str(input_md), "-t", "html"]
        cmd2 = [
            pandoc,
            "-f",
            "html",
            "-o",
            str(output_docx),
            "--reference-doc",
            str(reference_doc),
            *lua_arg,
        ]
        html = subprocess.check_output(cmd1, text=True, encoding="utf-8", errors="replace")
        subprocess.run(cmd2, input=html, text=True, check=True, encoding="utf-8")
    else:
        cmd = [
            pandoc,
            str(input_md),
            "-o",
            str(output_docx),
            "--reference-doc",
            str(reference_doc),
            *lua_arg,
        ]
        subprocess.run(cmd, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Markdown 转 Word（多模板）")
    parser.add_argument("-i", "--input", type=Path, default=DEFAULT_INPUT, help="输入 .md")
    parser.add_argument("-o", "--output", type=Path, help="输出 .docx（默认 output/<名>-<模板>.docx）")
    parser.add_argument("-t", "--template", help="模板 id，见 config/templates.json")
    parser.add_argument("--list-templates", action="store_true", help="列出模板")
    parser.add_argument("--no-html-pipe", action="store_true", help="不使用 html 管道（更快，HTML 支持较弱）")
    args = parser.parse_args()

    cfg = load_config()

    if args.list_templates:
        list_templates(cfg)
        return 0

    template = resolve_template(cfg, args.template)
    ref = ROOT / template["reference_doc"]
    if not ref.is_file():
        print(f"模板文件不存在: {ref}", file=sys.stderr)
        if template["id"] == "hutb-carbon-neutral":
            print("请阅读 templates/hutb-carbon-neutral/README.md 放置学校官方模板。", file=sys.stderr)
        else:
            print("请先运行: python scripts/setup_templates.py", file=sys.stderr)
        return 1

    input_md = args.input if args.input.is_absolute() else ROOT / args.input
    if not input_md.is_file():
        print(f"找不到输入文件: {input_md}", file=sys.stderr)
        return 1

    pandoc = find_pandoc()
    if pandoc == "pandoc" and not shutil.which("pandoc"):
        print(
            "未检测到 Pandoc。请安装后重试，例如:\n"
            "  winget install --id JohnMacFarlane.Pandoc\n"
            "  或 https://pandoc.org/installing.html",
            file=sys.stderr,
        )
        return 1

    out = args.output
    if out is None:
        out = DEFAULT_OUTPUT_DIR / f"{input_md.stem}-{template['id']}.docx"
    elif not out.is_absolute():
        out = ROOT / out

    lua = ROOT / cfg.get("lua_filter", "")
    print(f"模板: {template['name']} ({template['id']})")
    print(f"输入: {input_md}")
    print(f"输出: {out}")

    try:
        run_pandoc(
            pandoc,
            input_md,
            out,
            ref,
            lua,
            use_html_pipe=not args.no_html_pipe,
        )
    except subprocess.CalledProcessError as e:
        print(f"Pandoc 执行失败: {e}", file=sys.stderr)
        return e.returncode or 1

    print("完成。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
