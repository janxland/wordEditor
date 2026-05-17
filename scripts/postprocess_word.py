#!/usr/bin/env python3
"""
Word VBA 后处理：把 macros/*.bas 临时导入到目标 .docx，按顺序执行 3 个宏，保存关闭。

依赖：
  - Windows + 安装 Microsoft Word
  - pip install pywin32
  - Word 信任中心 → 启用「信任对 VBA 工程对象模型的访问」
      reg add "HKCU\\Software\\Microsoft\\Office\\16.0\\Word\\Security" /v AccessVBOM /t REG_DWORD /d 1 /f
    （Office 版本号可能是 14.0/15.0/16.0）

用法：
  python scripts/postprocess_word.py output/example-xxx.docx
  python scripts/postprocess_word.py "report1.docx" "report2.docx" --interactive
  python scripts/postprocess_word.py output/*.docx --skip-formula
"""

from __future__ import annotations

import argparse
import functools
import glob
import re
import sys
import tempfile
from pathlib import Path

# 控制台输出统一为 UTF-8（避免 GBK 默认控制台无法打印 ✓/✗ 等符号）
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# 无缓冲输出，方便实时观察 COM 进度
print = functools.partial(print, flush=True)  # type: ignore[assignment]

ROOT = Path(__file__).resolve().parents[1]
MACROS_DIR = ROOT / "macros"

MACRO_FILES = {
    "headings": MACROS_DIR / "ApplyHeadingsAndRemoveNumbering.bas",
    "formula":  MACROS_DIR / "ConvertLaTeXToWordFormula.bas",
    "refs":     MACROS_DIR / "ManualRefToBookmarkSuperscript.bas",
}

MACRO_ENTRIES = [
    ("headings", "modHeadings", "ApplyHeadingsAndRemoveNumbering"),
    ("formula",  "modFormula",  "ConvertLaTeXToWordFormula_Ultimate"),
    ("refs",     "modRefs",     "手动引用转书签交叉引用并设上标"),
]


def silence_msgbox(bas_text: str) -> str:
    """把 .bas 中所有 MsgBox 行注释掉（避免无人值守时弹窗阻塞）。"""
    return re.sub(r"(?m)^(\s*)(MsgBox\b.*)$", r"\1' [silenced] \2", bas_text)


def to_vbe_bytes(text: str) -> bytes:
    """把 .bas 源码编码为 VBE Import 可接受的字节。

    VBE 按系统 ANSI（中文 Windows = GBK / mbcs）解析。
    - 直接 UTF-8 写出：0x83 等会与下一个 ASCII 配对成 GBK 双字节字符，
      导致字符串未闭合 → 隐形「编译错误」对话框 → Run 死锁。
    - UTF-8 BOM 写出：BOM 在 Attribute VB_Name 之前，模块名被破坏 → 找不到宏。
    - 因此使用 mbcs。
    """
    return text.encode("mbcs", errors="replace")


def write_silenced(bas_path: Path, tmp_dir: Path) -> Path:
    text = bas_path.read_text(encoding="utf-8", errors="replace")
    silenced = silence_msgbox(text)
    out = tmp_dir / bas_path.name
    out.write_bytes(to_vbe_bytes(silenced))
    return out


def write_interactive(bas_path: Path, tmp_dir: Path) -> Path:
    out = tmp_dir / bas_path.name
    out.write_bytes(to_vbe_bytes(bas_path.read_text(encoding="utf-8", errors="replace")))
    return out


def check_access_vbom() -> tuple[bool, str]:
    """检测 HKCU 下任一 Office 版本是否启用 AccessVBOM。"""
    try:
        import winreg  # type: ignore
    except ImportError:
        return False, "winreg 不可用（非 Windows？）"

    hits = []
    for ver in ("16.0", "15.0", "14.0"):
        sub = rf"Software\Microsoft\Office\{ver}\Word\Security"
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, sub) as k:
                v, _ = winreg.QueryValueEx(k, "AccessVBOM")
                hits.append((ver, int(v)))
        except (FileNotFoundError, OSError):
            continue

    if not hits:
        msg = (
            "未检测到 Word 的 AccessVBOM 设置。请按 Office 版本号执行（默认 16.0）：\n"
            '  reg add "HKCU\\Software\\Microsoft\\Office\\16.0\\Word\\Security" '
            "/v AccessVBOM /t REG_DWORD /d 1 /f"
        )
        return False, msg
    if any(v == 1 for _, v in hits):
        return True, ""
    return False, (
        "Word 已禁用「信任对 VBA 工程对象模型的访问」。请在 Word 选项 → 信任中心 → "
        "宏设置里勾选，或执行：\n"
        '  reg add "HKCU\\Software\\Microsoft\\Office\\16.0\\Word\\Security" '
        "/v AccessVBOM /t REG_DWORD /d 1 /f"
    )


def process_one(word, doc_path: Path, macros_to_run, tmp_bas):
    print(f"  -> 打开：{doc_path}")
    doc = word.Documents.Open(str(doc_path.resolve()))
    print("    · 文档已打开，导入宏 …")
    try:
        vbproj = doc.VBProject
        imported_names = []
        for key, _module, _entry in macros_to_run:
            comp = vbproj.VBComponents.Import(str(tmp_bas[key].resolve()))
            imported_names.append(comp.Name)
            print(f"      - 已导入 {comp.Name}")

        proj_name = vbproj.Name
        for _key, module, entry in macros_to_run:
            full = f"{proj_name}.{module}.{entry}"
            print(f"    · 运行宏 {module}.{entry}")
            word.Run(full)
            word.DisplayAlerts = 0  # 宏内可能重置回 wdAlertsAll
            print(f"      [OK] {entry}")

        # 保存前移除导入的 VBA 组件，避免 .docx 触发「保存时丢失宏」弹窗
        for name in imported_names:
            try:
                vbproj.VBComponents.Remove(vbproj.VBComponents(name))
            except Exception:
                pass
        word.DisplayAlerts = 0
        print("    · 保存 …")
        doc.Save()
        print("    · 已保存")
    finally:
        doc.Close(SaveChanges=0)


def main() -> int:
    ap = argparse.ArgumentParser(description="对 .docx 文件批量执行 VBA 三宏后处理")
    ap.add_argument("files", nargs="+", help=".docx 文件，支持 glob")
    ap.add_argument("--skip-headings", action="store_true")
    ap.add_argument("--skip-formula", action="store_true")
    ap.add_argument("--skip-refs", action="store_true")
    ap.add_argument("--interactive", action="store_true",
                    help="保留 MsgBox 弹窗（调试用）")
    args = ap.parse_args()

    # 展开 glob
    targets: list[Path] = []
    for pat in args.files:
        matched = [Path(p) for p in glob.glob(pat)]
        if matched:
            targets.extend(matched)
        else:
            targets.append(Path(pat))
    targets = [p for p in targets if p.suffix.lower() in (".docx", ".docm")]
    if not targets:
        print("无可处理的 .docx/.docm 文件", file=sys.stderr)
        return 1

    macros_to_run = [
        t for t in MACRO_ENTRIES if not getattr(args, f"skip_{t[0]}")
    ]
    if not macros_to_run:
        print("所有宏均被跳过", file=sys.stderr)
        return 1

    for k, _m, _e in macros_to_run:
        if not MACRO_FILES[k].is_file():
            print(f"缺少宏文件：{MACRO_FILES[k]}", file=sys.stderr)
            return 1

    ok, msg = check_access_vbom()
    if not ok:
        print(msg, file=sys.stderr)
        return 2

    try:
        import win32com.client  # type: ignore
    except ImportError:
        print("缺少 pywin32：pip install pywin32", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory(prefix="wordeditor_bas_") as td:
        td_path = Path(td)
        tmp_bas: dict[str, Path] = {}
        for k, _m, _e in macros_to_run:
            tmp_bas[k] = (
                write_interactive(MACRO_FILES[k], td_path) if args.interactive
                else write_silenced(MACRO_FILES[k], td_path)
            )

        word = win32com.client.DispatchEx("Word.Application")
        # Visible=True 必须开：宏中使用 Selection.Select / Selection.Fields.Add，
        # Visible=False 时会与 Word 主循环死锁。窗口最小化以减少干扰。
        word.Visible = True
        try:
            word.WindowState = 2  # wdWindowStateMinimize
        except Exception:
            pass
        word.DisplayAlerts = 0  # wdAlertsNone

        failed: list[Path] = []
        try:
            for f in targets:
                if not f.is_file():
                    print(f"跳过（不存在）：{f}", file=sys.stderr)
                    failed.append(f)
                    continue
                try:
                    process_one(word, f, macros_to_run, tmp_bas)
                    print(f"    [完成] {f}")
                except Exception as e:  # noqa: BLE001
                    print(f"    [失败] {f} — {e}", file=sys.stderr)
                    failed.append(f)
        finally:
            word.Quit()

    if failed:
        print(f"\n共失败 {len(failed)} / {len(targets)}", file=sys.stderr)
        return 1
    print(f"\n全部完成（{len(targets)} 个）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
