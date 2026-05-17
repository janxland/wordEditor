#!/usr/bin/env python3
"""
批量构建 input/*.md → output/*.docx，支持 --postprocess 透传。

用法：
  python scripts/batch_build.py                       # 默认模板，input/*.md
  python scripts/batch_build.py -t sci-heading-number
  python scripts/batch_build.py --pattern "input/2026-*.md" --no-postprocess
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "scripts" / "build.py"


def main() -> int:
    ap = argparse.ArgumentParser(description="批量 Markdown → Word")
    ap.add_argument("--pattern", default="input/*.md", help="glob 匹配 .md（相对项目根）")
    ap.add_argument("-t", "--template", help="模板 id")
    ap.add_argument("--no-postprocess", action="store_true")
    ap.add_argument("--no-html-pipe", action="store_true")
    args = ap.parse_args()

    files = sorted((ROOT).glob(args.pattern))
    if not files:
        print(f"无匹配文件：{args.pattern}", file=sys.stderr)
        return 1

    ok, fail = [], []
    for md in files:
        print(f"\n=== {md.relative_to(ROOT)} ===")
        cmd = [sys.executable, str(BUILD), "-i", str(md)]
        if args.template:
            cmd += ["-t", args.template]
        if args.no_postprocess:
            cmd.append("--no-postprocess")
        if args.no_html_pipe:
            cmd.append("--no-html-pipe")
        rc = subprocess.call(cmd)
        (ok if rc == 0 else fail).append(md.name)

    print("\n========== 汇总 ==========")
    print(f"成功 {len(ok)} / {len(files)}")
    for n in ok:
        print(f"  ✓ {n}")
    for n in fail:
        print(f"  ✗ {n}")
    return 0 if not fail else 1


if __name__ == "__main__":
    raise SystemExit(main())
