#!/usr/bin/env python3
"""从 vendor/pandoc_docx_template 提取 Word 模板到 templates/builtin（ASCII 文件名，避免 Windows 乱码）。"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "vendor" / "pandoc_docx_template"
OUT = ROOT / "templates" / "builtin"

# git 中的中文文件名 -> 本项目模板 id
GIT_TO_ID = {
    "template_标题编号-列表第二行顶格.docx": "heading-number-list-flush.docx",
    "template_标题编号-列表第二行缩进.docx": "heading-number-list-indent.docx",
    "template_标题不编号-列表第二行顶格.docx": "no-heading-number-list-flush.docx",
    "template_标题不编号-列表第二行缩进.docx": "no-heading-number-list-indent.docx",
    "template_sci论文-标题编号.docx": "sci-heading-number.docx",
    "template_sci论文-标题不编号.docx": "sci-no-heading-number.docx",
}


def git_ls_docx() -> list[str]:
    out = subprocess.check_output(
        ["git", "-c", "core.quotepath=false", "ls-files", "*.docx"],
        cwd=VENDOR,
        text=True,
        encoding="utf-8",
    )
    return [line.strip() for line in out.splitlines() if line.strip()]


def extract_one(git_name: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    data = subprocess.check_output(
        ["git", "show", f"HEAD:{git_name}"],
        cwd=VENDOR,
    )
    dest.write_bytes(data)
    print(f"  OK  {dest.relative_to(ROOT)}")


def main() -> int:
    if not (VENDOR / ".git").is_dir():
        print("未找到 vendor/pandoc_docx_template，请先执行：")
        print("  git clone --depth 1 https://github.com/Achuan-2/pandoc_docx_template.git vendor/pandoc_docx_template")
        return 1

    names = git_ls_docx()
    missing = set(GIT_TO_ID) - set(names)
    if missing:
        print("上游模板文件有变更，请更新 GIT_TO_ID 映射：", missing, file=sys.stderr)
        return 1

    print("提取内置模板到 templates/builtin/ ...")
    for git_name, out_name in GIT_TO_ID.items():
        extract_one(git_name, OUT / out_name)

    print("完成。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
