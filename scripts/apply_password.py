#!/usr/bin/env python3
"""为 .docx 注入「修改密码」(writeProtection)。

仅设置「修改保护」：未输入密码者只能以只读方式打开/编辑（Word 提示
「另存为副本或仅以只读模式打开」），不对文件内容做加密。无需任何第三方依赖。

参考：ECMA-376 §17.15.1.120 writeProtection / Office Hash Algorithm
（cryptAlgorithmSid=14 → SHA-512，SpinCount 标准为 100000）。

用法：
  python scripts/apply_password.py <docx> --password <PWD>
  python scripts/apply_password.py <docx> --clear   # 移除修改保护
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import os
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from ooxml_util import W, q, patch_docx_parts  # noqa: E402

SETTINGS_PART = "word/settings.xml"
SPIN_COUNT = 100000
CRYPT_SID = 14  # SHA-512


def _hash_password(password: str, salt: bytes, spin_count: int = SPIN_COUNT) -> bytes:
    """ECMA-376 标准口令哈希（algorithmSid=14, SHA-512, 迭代 spin_count 次）。"""
    pw = password.encode("utf-16-le")
    h = hashlib.sha512(salt + pw).digest()
    for i in range(spin_count):
        h = hashlib.sha512(h + i.to_bytes(4, "little")).digest()
    return h


def _build_write_protection_attrs(password: str) -> dict[str, str]:
    salt = os.urandom(16)
    h = _hash_password(password, salt, SPIN_COUNT)
    return {
        q("cryptProviderType"): "rsaAES",
        q("cryptAlgorithmClass"): "hash",
        q("cryptAlgorithmType"): "typeAny",
        q("cryptAlgorithmSid"): str(CRYPT_SID),
        q("cryptSpinCount"): str(SPIN_COUNT),
        q("hash"): base64.b64encode(h).decode("ascii"),
        q("salt"): base64.b64encode(salt).decode("ascii"),
    }


def _patch_settings(data: bytes, password: str | None) -> bytes:
    ET.register_namespace("w", W)
    root = ET.fromstring(data)

    # 移除既有 writeProtection
    for old in root.findall(q("writeProtection")):
        root.remove(old)

    if password:
        wp = ET.Element(q("writeProtection"), _build_write_protection_attrs(password))
        # writeProtection 必须排在 settings 子元素的最前面（schema 顺序）
        root.insert(0, wp)

    xml = ET.tostring(root, encoding="utf-8", xml_declaration=True, short_empty_elements=True)
    return xml


def apply_password(docx_path: Path, password: str | None) -> None:
    if not docx_path.is_file():
        raise FileNotFoundError(docx_path)

    def patch(data: bytes) -> bytes:
        return _patch_settings(data, password)

    patch_docx_parts(docx_path, {SETTINGS_PART: patch})


def main() -> int:
    ap = argparse.ArgumentParser(description="为 .docx 设置 / 清除「修改密码」")
    ap.add_argument("docx", type=Path)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--password", help="修改密码（明文）")
    g.add_argument("--password-env", help="从环境变量读取修改密码")
    g.add_argument("--clear", action="store_true", help="移除修改密码")
    args = ap.parse_args()

    if args.clear:
        pwd: str | None = None
    elif args.password_env:
        pwd = os.environ.get(args.password_env)
        if not pwd:
            print(f"环境变量 {args.password_env} 为空", file=sys.stderr)
            return 2
    else:
        pwd = args.password
        if not pwd:
            print("--password 不能为空", file=sys.stderr)
            return 2

    apply_password(args.docx, pwd)
    print("[apply_password] 已设置修改密码" if pwd else "[apply_password] 已清除修改密码")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
