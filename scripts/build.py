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
    extra_lua_filters: list[Path],
    use_html_pipe: bool,
) -> None:
    output_docx.parent.mkdir(parents=True, exist_ok=True)
    lua_arg: list[str] = []
    if lua_filter.is_file():
        lua_arg += ["--lua-filter", str(lua_filter)]
    for f in extra_lua_filters:
        if f.is_file():
            lua_arg += ["--lua-filter", str(f)]

    if use_html_pipe:
        # 与上游 md2docx.sh 一致：经 HTML 中转以更好支持部分 HTML 标签
        # 加 tex_math_dollars + tex_math_single_backslash，让 HTML reader 重新识别
        # \(...\) / $...$ 为数学，DOCX writer 转为 Word 原生 OMML 公式
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
    parser.add_argument("--no-postprocess", action="store_true",
                        help="不运行后处理（VBA 宏 + OOXML 样式注入）")
    parser.add_argument("--render-math", action="store_true",
                        help="预渲染行内 LaTeX 为 Unicode（默认关，交由 Pandoc 生成 Word 原生公式 OMML）")
    parser.add_argument("--with-formula-macro", action="store_true",
                        help="后处理时仍跑 VBA 公式宏（默认跳过——公式已 OMML 化）")
    parser.add_argument("--interactive-macro", action="store_true",
                        help="后处理时 Word 可见 + 保留 MsgBox（调试）")
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
    extra_luas = [ROOT / p for p in template.get("extra_lua_filters", [])]
    print(f"模板: {template['name']} ({template['id']})")
    print(f"输入: {input_md}")
    print(f"输出: {out}")
    if extra_luas:
        print(f"额外 Lua: {[str(p.relative_to(ROOT)) for p in extra_luas]}")

    pandoc_input = input_md
    rendered_md: Path | None = None
    if args.render_math:
        rendered_md = DEFAULT_OUTPUT_DIR / f"{input_md.stem}.rendered.md"
        rendered_md.parent.mkdir(parents=True, exist_ok=True)
        rc = subprocess.call([
            sys.executable, str(ROOT / "scripts" / "render_math.py"),
            str(input_md), "-o", str(rendered_md),
        ])
        if rc != 0:
            print("LaTeX 预渲染失败。", file=sys.stderr)
            return rc
        pandoc_input = rendered_md

    try:
        run_pandoc(
            pandoc,
            pandoc_input,
            out,
            ref,
            lua,
            extra_luas,
            use_html_pipe=not args.no_html_pipe,
        )
    except subprocess.CalledProcessError as e:
        print(f"Pandoc 执行失败: {e}", file=sys.stderr)
        return e.returncode or 1

    print("完成。")

    if not args.no_postprocess:
        print("\n[后处理] 运行 VBA 宏 …")
        pp_args = [sys.executable, str(ROOT / "scripts" / "postprocess_word.py"), str(out)]
        if not args.with_formula_macro:
            pp_args.append("--skip-formula")
        if args.interactive_macro:
            pp_args.append("--interactive")
        import os as _os
        env = _os.environ.copy()
        env.setdefault("PYTHONIOENCODING", "utf-8")
        rc = subprocess.call(pp_args, env=env)
        if rc != 0:
            print("VBA 后处理失败。", file=sys.stderr)
            return rc
        print("\n[后处理] 注入 OOXML 样式 …")
        styles_cmd = [sys.executable, str(ROOT / "scripts" / "postprocess_styles.py"), str(out)]
        styles_yaml_rel = template.get("styles_yaml")
        if styles_yaml_rel:
            styles_yaml = ROOT / styles_yaml_rel
            if styles_yaml.is_file():
                styles_cmd += ["--styles", str(styles_yaml)]
            else:
                print(f"警告: styles_yaml 不存在 {styles_yaml}，退回内置 DSL", file=sys.stderr)
        rc = subprocess.call(styles_cmd, env=env)
        if rc != 0:
            print("OOXML 样式后处理失败。", file=sys.stderr)
            return rc
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
