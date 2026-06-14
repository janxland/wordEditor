"""build.py / preview_styles.py 共用的 OOXML 后处理编排。"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent


def spawn_env() -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("PYTHONIOENCODING", "utf-8")
    return env


def run_ooxml_postprocess(
    docx: Path,
    *,
    skip_headings: bool = False,
    skip_refs: bool = False,
    heading_scheme: str = "guanke",
) -> int:
    cmd = [
        sys.executable,
        str(SCRIPTS / "postprocess_document.py"),
        str(docx),
        "--heading-scheme",
        heading_scheme,
    ]
    if skip_headings:
        cmd.append("--skip-headings")
    if skip_refs:
        cmd.append("--skip-refs")
    return subprocess.call(cmd, env=spawn_env())


def run_document_postprocess(
    docx: Path,
    *,
    skip_refs: bool = False,
    skip_headings: bool = False,
    heading_scheme: str = "guanke",
) -> int:
    print(f"\n[后处理] 标题识别与交叉引用（OOXML · {heading_scheme}）…")
    return run_ooxml_postprocess(
        docx,
        skip_headings=skip_headings,
        skip_refs=skip_refs,
        heading_scheme=heading_scheme,
    )


def run_styles_postprocess(docx: Path, styles_yaml: Path) -> int:
    return subprocess.call(
        [
            sys.executable,
            str(SCRIPTS / "postprocess_styles.py"),
            str(docx),
            "--styles",
            str(styles_yaml),
        ],
        env=spawn_env(),
    )
