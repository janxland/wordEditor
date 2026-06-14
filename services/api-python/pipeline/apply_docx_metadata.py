#!/usr/bin/env python3
"""为 .docx 写入作者、备注等文档属性（产出留痕，无需 Word）。"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from xml.etree import ElementTree as ET

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from ooxml_util import patch_docx_parts  # noqa: E402

CORE_PART = "docProps/core.xml"
APP_PART = "docProps/app.xml"

CP = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
DC = "http://purl.org/dc/elements/1.1/"
DCTERMS = "http://purl.org/dc/terms/"
XSI = "http://www.w3.org/2001/XMLSchema-instance"
APP = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"

CP_NS = {"cp": CP, "dc": DC, "dcterms": DCTERMS, "xsi": XSI}


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ensure_child_text(parent: ET.Element, tag: str, value: str) -> None:
    el = parent.find(tag)
    if el is None:
        el = ET.SubElement(parent, tag)
    el.text = value


def _patch_core(
    data: bytes,
    *,
    author: str | None,
    remark: str | None,
    title: str | None,
) -> bytes:
    for prefix, uri in CP_NS.items():
        ET.register_namespace(prefix, uri)

    root = ET.fromstring(data)
    if author:
        _ensure_child_text(root, f"{{{DC}}}creator", author)
        _ensure_child_text(root, f"{{{CP}}}lastModifiedBy", author)
    if remark is not None:
        _ensure_child_text(root, f"{{{DC}}}description", remark)
    if title is not None:
        _ensure_child_text(root, f"{{{DC}}}title", title)

    now = _utc_now()
    modified = root.find(f"{{{DCTERMS}}}modified")
    if modified is None:
        modified = ET.SubElement(root, f"{{{DCTERMS}}}modified")
    modified.set(f"{{{XSI}}}type", "dcterms:W3CDTF")
    modified.text = now

    created = root.find(f"{{{DCTERMS}}}created")
    if created is None:
        created = ET.SubElement(root, f"{{{DCTERMS}}}created")
        created.set(f"{{{XSI}}}type", "dcterms:W3CDTF")
        created.text = now

    return ET.tostring(root, encoding="utf-8", xml_declaration=True, short_empty_elements=True)


def _patch_app(data: bytes) -> bytes:
    ET.register_namespace("", APP)
    root = ET.fromstring(data)
    _ensure_child_text(root, f"{{{APP}}}Application", "WordEditor")
    return ET.tostring(root, encoding="utf-8", xml_declaration=True, short_empty_elements=True)


def apply_docx_metadata(
    docx_path: Path,
    *,
    author: str | None = None,
    remark: str | None = None,
    title: str | None = None,
) -> None:
    if not docx_path.is_file():
        raise FileNotFoundError(docx_path)
    if not any(v for v in (author, remark, title) if v is not None):
        return

    def patch_core(data: bytes) -> bytes:
        return _patch_core(data, author=author, remark=remark, title=title)

    patches: dict[str, Callable[[bytes], bytes]] = {CORE_PART: patch_core}
    if author or remark is not None or title is not None:
        patches[APP_PART] = _patch_app
    patch_docx_parts(docx_path, patches)


def main() -> int:
    ap = argparse.ArgumentParser(description="写入 .docx 文档属性（作者 / 备注 / 标题）")
    ap.add_argument("docx", type=Path)
    ap.add_argument("--author", help="作者（dc:creator / lastModifiedBy）")
    ap.add_argument("--remark", help="备注（dc:description，Word 属性「备注」）")
    ap.add_argument("--doc-title", dest="doc_title", help="标题（dc:title）")
    args = ap.parse_args()

    if not any((args.author, args.remark, args.doc_title)):
        print("[apply_docx_metadata] 未指定任何属性，已跳过", file=sys.stderr)
        return 0

    apply_docx_metadata(
        args.docx,
        author=args.author,
        remark=args.remark,
        title=args.doc_title,
    )
    bits = []
    if args.author:
        bits.append(f"author={args.author!r}")
    if args.remark is not None:
        bits.append(f"remark={args.remark!r}")
    if args.doc_title is not None:
        bits.append(f"title={args.doc_title!r}")
    print(f"[apply_docx_metadata] {' · '.join(bits)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
