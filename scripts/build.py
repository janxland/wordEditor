#!/usr/bin/env python3
"""
Markdown → Word（湖南工商大学 · 碳中和模板）。

用法:
  python scripts/build.py
  python scripts/build.py -i report.md
  python scripts/build.py --list-templates
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from postprocess_pipeline import run_document_postprocess, run_styles_postprocess  # noqa: E402
from tool_paths import find_pandoc  # noqa: E402

CONFIG_PATH = ROOT / "config" / "templates.json"
DEFAULT_INPUT = ROOT / "input" / "carbon-neutral-renewable.md"
DEFAULT_OUTPUT_DIR = ROOT / "output"
DEFAULT_TEMPLATE_ID = "hutb-guanke"


def load_config() -> dict:
    with CONFIG_PATH.open(encoding="utf-8") as f:
        return json.load(f)


TEMPLATE_ALIASES = {"hutb-carbon-neutral": "hutb-guanke"}


def resolve_template(cfg: dict, template_id: str | None) -> dict:
    tid = template_id or cfg.get("default_template") or DEFAULT_TEMPLATE_ID
    tid = TEMPLATE_ALIASES.get(tid, tid)
    for t in cfg["templates"]:
        if t["id"] == tid:
            return t
    ids = ", ".join(t["id"] for t in cfg["templates"])
    raise SystemExit(f"未知模板 '{tid}'。可用: {ids}")


def resolve_lua_filters(template: dict) -> list[Path]:
    """模板内 Lua 过滤器链（markdown-to-docx → zhengwen-style）。"""
    paths: list[Path] = []
    tpl_lua = template.get("lua_filter")
    if tpl_lua:
        paths.append(ROOT / tpl_lua)
    else:
        raise SystemExit(
            f"模板「{template['name']}」须在 templates.json 中配置 lua_filter。"
        )
    for rel in template.get("extra_lua_filters", []):
        paths.append(ROOT / rel)
    return paths


def list_templates(cfg: dict) -> None:
    print("可用模板 (--template / -t):\n")
    for t in cfg["templates"]:
        ref = ROOT / t["reference_doc"]
        ok = "OK" if ref.is_file() else "缺少 reference.docx"
        note = f"  — {t['note']}" if t.get("note") else ""
        print(f"  {t['id']:<28} {t['name']}{note}")
        print(f"    {'':28} [{ok}] {t['reference_doc']}\n")


def run_pandoc(
    pandoc: str,
    input_md: Path,
    output_docx: Path,
    reference_doc: Path,
    lua_filters: list[Path],
    use_html_pipe: bool,
) -> None:
    output_docx.parent.mkdir(parents=True, exist_ok=True)
    lua_arg: list[str] = []
    for f in lua_filters:
        if f.is_file():
            lua_arg += ["--lua-filter", str(f)]
        else:
            print(f"警告: Lua 过滤器不存在，已跳过: {f}", file=sys.stderr)

    if use_html_pipe:
        md_dir = str(input_md.parent)
        cmd1 = [
            pandoc,
            str(input_md),
            "-f",
            "markdown+tex_math_single_backslash",
            "-t",
            "html",
            "--mathjax",
            "--embed-resources",
            "--standalone",
            f"--resource-path={md_dir}",
        ]
        cmd2 = [
            pandoc,
            "-f",
            "html+tex_math_dollars+tex_math_single_backslash",
            "-o",
            str(output_docx),
            "--reference-doc",
            str(reference_doc),
            f"--resource-path={md_dir}",
            *lua_arg,
        ]
        html = subprocess.check_output(cmd1, text=True, encoding="utf-8", errors="replace")
        # 移除 standalone HTML 在 body 中的标题块，避免与 <head><title> 同时被
        # HTML→DOCX 阶段读入而产生两次 Title 段（原「形策模板标题重复」根因）。
        html = re.sub(
            r"<header[^>]*id=[\"']title-block-header[\"'][^>]*>.*?</header>",
            "",
            html,
            count=1,
            flags=re.DOTALL | re.IGNORECASE,
        )
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
    parser = argparse.ArgumentParser(description="Markdown 转 Word（碳中和模板）")
    parser.add_argument("-i", "--input", type=Path, default=DEFAULT_INPUT, help="输入 .md")
    parser.add_argument("-o", "--output", type=Path, help="输出 .docx（默认 output/<名>-<模板>.docx）")
    parser.add_argument("-t", "--template", help="模板 id（默认 hutb-guanke；hutb-carbon-neutral 等同管科）")
    parser.add_argument("--list-templates", action="store_true", help="列出模板")
    parser.add_argument("--no-html-pipe", action="store_true", help="不使用 html 管道（更快，HTML 支持较弱）")
    parser.add_argument(
        "--no-postprocess",
        action="store_true",
        help="不运行后处理（标题/引用 + OOXML 样式注入）",
    )
    args = parser.parse_args()

    cfg = load_config()

    if args.list_templates:
        list_templates(cfg)
        return 0

    template = resolve_template(cfg, args.template)
    ref = ROOT / template["reference_doc"]
    if not ref.is_file():
        print(f"模板文件不存在: {ref}", file=sys.stderr)
        print("请阅读 templates/hutb-carbon-neutral/README.md 放置学校官方 reference.docx。", file=sys.stderr)
        return 1

    input_md = args.input if args.input.is_absolute() else ROOT / args.input
    if not input_md.is_file():
        print(f"找不到输入文件: {input_md}", file=sys.stderr)
        return 1

    pandoc = find_pandoc()
    if not pandoc:
        print(
            "未检测到 Pandoc。请安装后重试，例如:\n"
            "  winget install --id JohnMacFarlane.Pandoc\n"
            "  或 https://pandoc.org/installing.html\n"
            "已安装但仍报错时，可设置环境变量 PANDOC 指向 pandoc.exe 完整路径。",
            file=sys.stderr,
        )
        return 1

    out = args.output
    if out is None:
        out = DEFAULT_OUTPUT_DIR / f"{input_md.stem}-{template['id']}.docx"
    elif not out.is_absolute():
        out = ROOT / out

    lua_filters = resolve_lua_filters(template)
    print(f"模板: {template['name']} ({template['id']})")
    print(f"输入: {input_md}")
    print(f"输出: {out}")
    if lua_filters:
        print(f"Lua: {[str(p.relative_to(ROOT)) for p in lua_filters]}")

    try:
        run_pandoc(
            pandoc,
            input_md,
            out,
            ref,
            lua_filters,
            use_html_pipe=not args.no_html_pipe,
        )
    except subprocess.CalledProcessError as e:
        print(f"Pandoc 执行失败: {e}", file=sys.stderr)
        return e.returncode or 1

    print("完成。")

    if not args.no_postprocess:
        scheme = template.get("heading_numbering", "guanke")
        rc = run_document_postprocess(out, heading_scheme=scheme)
        if rc != 0:
            print("文档结构后处理失败。", file=sys.stderr)
            return rc
        styles_yaml_rel = template.get("styles_yaml")
        if styles_yaml_rel:
            styles_yaml = ROOT / styles_yaml_rel
            if not styles_yaml.is_file():
                print(f"错误: styles_yaml 不存在 {styles_yaml}", file=sys.stderr)
                return 1
            print("\n[后处理] 注入 OOXML 样式 …")
            rc = run_styles_postprocess(out, styles_yaml)
            if rc != 0:
                print("OOXML 样式后处理失败。", file=sys.stderr)
                return rc
        if template.get("three_line_tables"):
            print("\n[后处理] 三线表边框 …")
            rc = subprocess.call(
                [sys.executable, str(SCRIPT_DIR / "ooxml_three_line_table.py"), str(out)]
            )
            if rc != 0:
                print("三线表后处理失败。", file=sys.stderr)
                return rc
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
