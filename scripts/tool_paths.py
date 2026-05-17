#!/usr/bin/env python3
"""定位本机工具路径（Pandoc / Python），供 build.py 与前端 preflight 共用。"""

from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path


def _iter_pandoc_candidates() -> list[Path]:
    home = Path.home()
    fixed = [
        Path(os.environ.get("PANDOC", "")),
        Path(r"C:\Program Files\Pandoc\pandoc.exe"),
        Path(r"C:\Program Files (x86)\Pandoc\pandoc.exe"),
        home / "AppData/Local/Pandoc/pandoc.exe",
    ]
    out: list[Path] = [p for p in fixed if str(p) and str(p) != "."]

    winget_pkgs = home / "AppData/Local/Microsoft/WinGet/Packages"
    if winget_pkgs.is_dir():
        for pkg in sorted(winget_pkgs.iterdir()):
            if "pandoc" not in pkg.name.lower():
                continue
            for exe in pkg.rglob("pandoc.exe"):
                out.append(exe)

    scoop = home / "scoop/apps/pandoc/current/pandoc.exe"
    if scoop.is_file():
        out.append(scoop)

    choco = Path(r"C:\ProgramData\chocolatey\bin\pandoc.exe")
    if choco.is_file():
        out.append(choco)

    return out


def find_pandoc() -> str | None:
    which = shutil.which("pandoc")
    if which:
        return which
    for p in _iter_pandoc_candidates():
        if p.is_file():
            return str(p.resolve())
    return None


def get_tools_status() -> dict:
    pandoc = find_pandoc()
    return {
        "pandoc": {
            "ok": pandoc is not None,
            "path": pandoc,
            "hint": None
            if pandoc
            else "winget install --id JohnMacFarlane.Pandoc",
        },
        "python": {
            "ok": True,
            "path": sys.executable,
        },
    }


def main() -> int:
    if "--json" in sys.argv:
        print(json.dumps(get_tools_status(), ensure_ascii=False))
        return 0
    pandoc = find_pandoc()
    if pandoc:
        print(pandoc)
        return 0
    print("pandoc not found", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
