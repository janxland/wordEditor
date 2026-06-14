#!/usr/bin/env python3
"""样式预览：样例 MD → Pandoc → OOXML 标题/引用 → postprocess_styles。"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from build import (  # noqa: E402
    load_config,
    resolve_lua_filters,
    resolve_template,
    run_pandoc,
)
from postprocess_pipeline import run_document_postprocess, run_styles_postprocess  # noqa: E402
from preview_images import materialize_markdown_images  # noqa: E402
from tool_paths import find_pandoc  # noqa: E402


def preview_md_for_template(template_id: str) -> Path:
    p = ROOT / "templates" / template_id / "preview-styles.md"
    if not p.is_file():
        raise SystemExit(f"缺少样式样例稿: templates/{template_id}/preview-styles.md")
    return p


def run_style_preview(
    template_id: str,
    output_docx: Path,
    styles_yaml: Path,
    *,
    fast: bool = False,
    skip_refs: bool = False,
) -> None:
    cfg = load_config()
    template = resolve_template(cfg, template_id)
    ref = ROOT / template["reference_doc"]
    if not ref.is_file():
        raise SystemExit(f"模板文件不存在: {ref}")

    if not styles_yaml.is_file():
        raise SystemExit(f"styles.yaml 不存在: {styles_yaml}")

    pandoc = find_pandoc()
    if not pandoc:
        raise SystemExit("未检测到 Pandoc")

    src_md = preview_md_for_template(template_id)
    work_dir = output_docx.parent
    work_dir.mkdir(parents=True, exist_ok=True)
    md_text = materialize_markdown_images(src_md.read_text(encoding="utf-8"), work_dir)
    input_md = work_dir / "preview-input.md"
    input_md.write_text(md_text, encoding="utf-8")

    lua_filters = resolve_lua_filters(template)

    print(f"[preview] 模板: {template['name']} ({template_id})")
    print(f"[preview] 样例: {src_md.relative_to(ROOT)}")
    print(f"[preview] 输出: {output_docx}")
    print("[preview] 图片: CDN 下载并嵌入（失败时回退仓库 input/images/）")

    run_pandoc(
        pandoc,
        input_md,
        output_docx,
        ref,
        lua_filters,
        use_html_pipe=not fast,
    )
    print("完成。")

    scheme = template.get("heading_numbering", "guanke")
    rc = run_document_postprocess(output_docx, skip_refs=skip_refs, heading_scheme=scheme)
    if rc != 0:
        raise RuntimeError("文档结构后处理失败")

    print("\n[后处理] 注入 OOXML 样式 …")
    rc = run_styles_postprocess(output_docx, styles_yaml)
    if rc != 0:
        raise RuntimeError("postprocess_styles 失败")
    print("[postprocess_styles] 完成")
    print("[preview] 完成")


def main() -> int:
    ap = argparse.ArgumentParser(description="生成样式预览 docx（OOXML 标题识别，无需 Word）")
    ap.add_argument("-t", "--template", required=True, help="模板 id")
    ap.add_argument("-o", "--output", type=Path, required=True, help="输出 docx")
    ap.add_argument("--styles", type=Path, required=True, help="styles.yaml 路径")
    ap.add_argument(
        "--fast",
        action="store_true",
        help="跳过 HTML 管道（更快，但公式支持较弱）",
    )
    ap.add_argument(
        "--skip-refs",
        action="store_true",
        help="跳过参考文献交叉引用",
    )
    args = ap.parse_args()
    try:
        run_style_preview(
            args.template,
            args.output,
            args.styles,
            fast=args.fast,
            skip_refs=args.skip_refs,
        )
    except SystemExit:
        return 1
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
