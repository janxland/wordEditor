"""字节级切片：从源 docx 原样切出封面 / 评分表块并登记 rId 与 media。"""
import json
import re
import zipfile
from pathlib import Path

from lxml import etree

from .ooxml import _RID_ATTR_B, _open_tag_end, iter_body_top_level
from ooxml_ns import W  # noqa: E402  命名空间 URI 唯一定义处

def slice_block(src_docx: Path, start: int, end: int, prefix: str, out_dir: Path) -> dict:
    """从源 docx 的 document.xml **原样切字节** [start, end) 打包成块。

    保留一切：rsid、proofErr、bookmarkStart/End 成对、命名空间前缀用法、图片引用。
    只做两件必要的事：去掉顶层段落内嵌的 sectPr、登记所用 rId 与其 media。
    """
    import zipfile
    with zipfile.ZipFile(src_docx) as z:
        raw = z.read("word/document.xml")
        names = z.namelist()
        rels_raw = z.read("word/_rels/document.xml.rels") if \
            "word/_rels/document.xml.rels" in names else b"<Relationships/>"

    spans = list(iter_body_top_level(raw))
    if not (0 <= start < end <= len(spans)):
        raise SystemExit(f"切片越界: [{start}, {end}) / body 共 {len(spans)} 个顶层元素")

    # 源文档根元素上的 xmlns 声明 —— 抄到包裹元素上，保证所有前缀都有绑定
    root_end = _open_tag_end(raw, raw.find(b"<w:document"))
    root_tag = raw[raw.find(b"<w:document"):root_end + 1]
    ns_decls = b" ".join(re.findall(rb'xmlns:[A-Za-z0-9_.-]+="[^"]*"', root_tag))
    if b'xmlns:w="' not in ns_decls:
        ns_decls = f'xmlns:w="{W}" '.encode() + ns_decls

    frags, dropped_sect = [], 0
    for name, a, bpos in spans[start:end]:
        frag = raw[a:bpos]
        # 去顶层段落内嵌 sectPr（它会截断正文的节属性）
        m = re.match(rb'(<w:p\b[^>]*>\s*<w:pPr>)(.*?)(</w:pPr>)', frag, re.S)
        if m and b"<w:sectPr" in m.group(2):
            inner = re.sub(rb'<w:sectPr\b.*?</w:sectPr>', b'', m.group(2), flags=re.S)
            frag = m.group(1) + inner + m.group(3) + frag[m.end():]
            dropped_sect += 1
        frags.append(frag)

    # rId 登记 + media 抽取
    PKG_R = "http://schemas.openxmlformats.org/package/2006/relationships"
    rel_map = {}
    for rel in etree.fromstring(rels_raw).findall(f"{{{PKG_R}}}Relationship"):
        rel_map[rel.get("Id")] = {
            "type": rel.get("Type"), "target": rel.get("Target"),
            "external": rel.get("TargetMode") == "External",
        }
    body_bytes = b"".join(frags)
    used = {rid: rel_map[rid] for rid in
            {m.group(2).decode() for m in _RID_ATTR_B.finditer(body_bytes)} if rid in rel_map}

    media: dict[str, bytes] = {}
    with zipfile.ZipFile(src_docx) as z:
        for rid, info in used.items():
            if info["external"] or not info["target"].startswith("media/"):
                continue
            entry = "word/" + info["target"]
            if entry in names:
                media[rid] = z.read(entry)

    out_dir.mkdir(parents=True, exist_ok=True)
    # 包裹：w:blocks + 源根 xmlns 全量声明；注入时只取 inner 原样拼进 body
    (out_dir / f"{prefix}_block.xml").write_bytes(
        b"<?xml version='1.0' encoding='UTF-8'?>\n<w:blocks " + ns_decls + b">"
        + body_bytes + b"</w:blocks>")
    (out_dir / f"{prefix}_rels.json").write_text(
        json.dumps({rid: {"type": i["type"], "target": i["target"], "external": i["external"]}
                    for rid, i in used.items()}, ensure_ascii=False, indent=1), encoding="utf-8")
    mdir = out_dir / f"{prefix}_media"
    if media:
        mdir.mkdir(parents=True, exist_ok=True)
        for rid, data in media.items():
            ext = Path(used[rid]["target"]).suffix or ".bin"
            (mdir / f"{rid}{ext}").write_bytes(data)
    elif mdir.is_dir():
        for f in mdir.iterdir():
            f.unlink()

    return {"slice": [start, end], "elements": len(frags),
            "bytes": len(body_bytes), "rels": len(used), "media": len(media),
            "sect_pr_dropped": dropped_sect,
            "bookmarks": len(re.findall(rb"<w:bookmarkStart\b", body_bytes)),
            "raw": True}

