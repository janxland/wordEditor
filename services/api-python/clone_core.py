#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""docx → 模板反向复刻核心（不碰默认模板）。

两种用法:
  1. 分析:      analyze_docx(path)                  → 格式/封面结构报告，只读
  2. 复刻注册:  clone_template(src, new_id, ...)    → 新模板（含封面块），全通道可用

原理:
  - pandoc --reference-doc 复用源 docx 的 styles.xml + sectPr + 页眉页脚（格式层）
  - 源 docx 中正文起点（第一个 Title/Heading 或摘要标记）之前的内容 → 封面块
    （封面、评分表等），构建后原样注入到产物开头
  - 注册进 config/templates.json 的条目 source="derived"，可用 remove_template 撤销

注意：新增模板**优先走 tpl_factory**（spec.yaml 是唯一数据源，自带 detect/analyze/build/verify
全链路）；本模块是它的能力底座与旧路径，MCP / CLI 的 clone_template 走工厂。

命令行:
  python clone_core.py analyze  <docx>
  python clone_core.py clone    <docx> <new_id> [--marker 摘要] [--numbering gongke|guanke] [--name 显示名]
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
import zipfile
from pathlib import Path

from lxml import etree

# 仓库根的唯一来源：环境变量 WORDEDITOR_ROOT 优先，回退按本文件位置推导（不硬编码绝对路径）。
# style_core / tpl_factory 一律从这里 import，不要再各算一份。
WORDEDITOR_ROOT = Path(os.environ.get("WORDEDITOR_ROOT", Path(__file__).resolve().parents[2]))
CONFIG = WORDEDITOR_ROOT / "config" / "templates.json"
_API_DIR = Path(__file__).resolve().parent
_PIPE_DIR = _API_DIR / "pipeline"
for _p in (str(_API_DIR), str(_PIPE_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from ooxml_ns import NS, R, W  # noqa: E402  命名空间 URI 唯一定义处（见 pipeline 侧的同样 import）

RID_ATTRS = {f"{{{R}}}{k}" for k in ("embed", "link", "id", "pict", "dm", "lo", "qs", "cs")}
RID_RE = re.compile(r"^rId\d+$")

# ---------------------------------------------------------------- 基础工具

def _load_parts(docx: Path):
    """读 docx 的 document.xml / styles.xml / rels。"""
    with zipfile.ZipFile(docx) as z:
        doc = etree.fromstring(z.read("word/document.xml"))
        names = z.namelist()
        styles = etree.fromstring(z.read("word/styles.xml")) if "word/styles.xml" in names else None
        rels = etree.fromstring(z.read("word/_rels/document.xml.rels"))
    return doc, styles, rels


def _style_names(styles) -> dict:
    """styleId → 样式名（w:name val，小写）。缺 styleId 的样式跳过。"""
    out = {}
    if styles is None:
        return out
    for st in styles.findall(f"{{{W}}}style"):
        sid = st.get(f"{{{W}}}styleId")
        nm = st.find(f"{{{W}}}name")
        if sid and nm is not None:
            out[sid] = (nm.get(f"{{{W}}}val") or "").lower()
    return out


def _para_text(p) -> str:
    return "".join(t.text or "" for t in p.findall(f".//{{{W}}}t")).strip()


def _find_cut(doc, styles, marker: str | None) -> int | None:
    """正文起点索引：第一个 Title/Heading 段落或含 marker 的段落。"""
    names = _style_names(styles)
    body = doc.find(f"{{{W}}}body")
    for i, el in enumerate(body):
        if not el.tag.endswith("}p"):
            continue
        name = ""
        ps = el.find(f"{{{W}}}pPr/{{{W}}}pStyle")
        if ps is not None:
            name = names.get(ps.get(f"{{{W}}}val"), "")
        if name == "title" or re.match(r"^heading \d", name):
            return i
        if marker and marker in _para_text(el):
            return i
    return None


# ---------------------------------------------------------------- 分析

def analyze_docx(path: str | Path) -> dict:
    """只读分析：页面设置、样式概览、封面范围。"""
    path = Path(path).expanduser().resolve()
    doc, styles, _ = _load_parts(path)
    body = doc.find(f"{{{W}}}body")
    names = _style_names(styles)

    sect = body.find(f"{{{W}}}sectPr")
    page = {}
    if sect is not None:
        pg = sect.find(f"{{{W}}}pgSz")
        mg = sect.find(f"{{{W}}}pgMar")
        if pg is not None:
            page["页宽x高"] = f"{int(pg.get(f'{{{W}}}w', 0))/567:.1f}cm x {int(pg.get(f'{{{W}}}h', 0))/567:.1f}cm"
        if mg is not None:
            page["边距(上右下左)"] = " / ".join(
                f"{int(mg.get(f'{{{W}}}{k}', 0))/567:.1f}cm" for k in ("top", "right", "bottom", "left"))

    n_styles = len(styles.findall(f"{{{W}}}style")) if styles is not None else 0
    n_tables = len(body.findall(f"{{{W}}}tbl"))
    cut = _find_cut(doc, styles, None)
    cover_desc = []
    if cut:
        for el in body[:cut]:
            if el.tag.endswith("}tbl"):
                rows = len(el.findall(f"{{{W}}}tr"))
                cover_desc.append(f"[表格 {rows}行] {(_para_text(el.findall(f'{{{W}}}tr')[0])[0] if rows else '')[:0]}{etree.tostring(el, encoding='unicode')[:0]}表:{rows}行")
            else:
                t = _para_text(el)
                if t:
                    cover_desc.append(t[:30])
    return {
        "file": str(path), "page": page, "styles": n_styles,
        "tables_total": n_tables, "cover_elements": cut or 0,
        "cover_preview": cover_desc[:12],
        "content_starts": (_para_text(body[cut]) if cut is not None else "（未检测到标题/摘要起点，可用 --marker 指定）"),
    }


# ---------------------------------------------------------------- 块抽取（封面/尾部共用）

def _save_block(elements: list, out_dir: Path, prefix: str, rels, src_docx: Path) -> dict:
    """把一组 body 元素存为 <prefix>_block.xml + rels/media 产物。"""
    rel_map = {}
    for rel in rels.findall("{http://schemas.openxmlformats.org/package/2006/relationships}Relationship"):
        rel_map[rel.get("Id")] = {
            "type": rel.get("Type"), "target": rel.get("Target"),
            "external": rel.get("TargetMode") == "External",
        }
    used = {}
    for el in elements:
        for rid in _collect_rids(el):
            if rid in rel_map:
                used[rid] = rel_map[rid]

    media: dict[str, bytes] = {}
    with zipfile.ZipFile(src_docx) as z:
        names = z.namelist()
        for rid, info in used.items():
            if info["external"] or not info["target"].startswith("media/"):
                continue
            entry = "word/" + info["target"]
            if entry in names:
                media[rid] = z.read(entry)

    wrap = etree.Element(prefix, nsmap={k: v for k, v in (elements[0].nsmap or {}).items() if k})
    for el in elements:
        wrap.append(el)
    (out_dir / f"{prefix}_block.xml").write_bytes(
        etree.tostring(wrap, xml_declaration=True, encoding="UTF-8"))
    (out_dir / f"{prefix}_rels.json").write_text(
        json.dumps({rid: {"type": i["type"], "target": i["target"], "external": i["external"]}
                    for rid, i in used.items()}, ensure_ascii=False, indent=1), encoding="utf-8")
    if media:
        mdir = out_dir / f"{prefix}_media"
        mdir.mkdir(exist_ok=True)
        for rid, data in media.items():
            ext = Path(used[rid]["target"]).suffix or ".bin"
            (mdir / f"{rid}{ext}").write_bytes(data)
    return {"elements": len(elements), "rels": len(used), "media": len(media)}


# ---------------------------------------------------------------- 封面块抽取

def _collect_rids(el) -> set:
    rids = set()
    for e in el.iter():
        for k, v in e.attrib.items():
            if k in RID_ATTRS and RID_RE.match(v or ""):
                rids.add(v)
    return rids


def extract_cover(path: Path, marker: str | None, out_dir: Path) -> dict:
    """把正文起点之前的元素抽成封面块：cover_block.xml + cover_rels.json + cover_media/。"""
    doc, styles, rels = _load_parts(path)
    cut = _find_cut(doc, styles, marker)
    if cut is None:
        raise SystemExit(f"未找到正文起点（第一个 Title/Heading 段落），请用 marker= 指定，如 marker='摘要'")
    body = doc.find(f"{{{W}}}body")
    cover = [etree.fromstring(etree.tostring(el)) for el in body[:cut]]
    if not cover:
        raise SystemExit("正文起点之前没有内容（无封面块）")

    # 去掉封面内嵌的 sectPr（避免改变正文节属性）
    for el in cover:
        ppr = el.find(f"{{{W}}}pPr")
        if ppr is not None:
            sp = ppr.find(f"{{{W}}}sectPr")
            if sp is not None:
                ppr.remove(sp)

    info = _save_block(cover, out_dir, "cover", rels, path)
    info["cut"] = cut
    with zipfile.ZipFile(path) as z:
        has_break = any(b.get(f"{{{W}}}type") == "page"
                        for el in cover for b in el.findall(f".//{{{W}}}br"))
    info["had_page_break"] = has_break
    return info


# ---------------------------------------------------------------- 尾部块抽取

# 尾页评分表的识别词。全仓唯一一份（tpl_factory/detect.py 从此处 import）。
# 取两家历史取值的并集：工厂探测用的宽集合覆盖了旧路径的窄集合。
TAIL_MARKERS = ("评审", "评分", "成绩", "评阅", "评定", "评语", "打分", "打分表", "教师签名")

def extract_tail(path: Path, out_dir: Path) -> dict | None:
    """抽取文档末尾的评分/评审表块（标题段 + 末表 + 表后内容）。

    识别规则：最后一张表的前置非空段落标题含 评审/评分/成绩/评阅。找不到返回 None。"""
    doc, styles, rels = _load_parts(path)
    body = doc.find(f"{{{W}}}body")
    children = [el for el in body if not el.tag.endswith("}sectPr")]
    tbl_idx = [i for i, el in enumerate(children) if el.tag.endswith("}tbl")]
    if not tbl_idx:
        return None
    last_tbl = tbl_idx[-1]
    # 向前找块标题段（允许中间隔空段）
    start = None
    for i in range(last_tbl - 1, max(last_tbl - 6, -1), -1):
        el = children[i]
        if not el.tag.endswith("}p"):
            break
        t = _para_text(el)
        if not t:
            continue
        if any(m in t for m in TAIL_MARKERS):
            start = i
        break  # 只看最近一个非空段
    if start is None:
        return None
    tail = [etree.fromstring(etree.tostring(el)) for el in children[start:]]
    for el in tail:  # 去内嵌 sectPr
        ppr = el.find(f"{{{W}}}pPr")
        if ppr is not None:
            sp = ppr.find(f"{{{W}}}sectPr")
            if sp is not None:
                ppr.remove(sp)
    return _save_block(tail, out_dir, "tail", rels, path)


# ---------------------------------------------------------------- 块注入

def _inject_block(docx_path: Path, cover_dir: Path, prefix: str, at: str) -> Path:
    """把 <prefix>_block 注入 docx：at="start"（开头）或 "end"（末尾，自动补分页）。

    块文件根为 <w:blocks> 时走 **字节级原样拼接** 路径：产物 document.xml 除插入
    位置外一个字节都不改，块内容也与源 docx 逐字节相同（只重映射 rId）。
    """
    block_bytes = (cover_dir / f"{prefix}_block.xml").read_bytes()
    rels_info = json.loads((cover_dir / f"{prefix}_rels.json").read_text(encoding="utf-8"))
    with zipfile.ZipFile(docx_path) as z:
        entries = {n: z.read(n) for n in z.namelist()}

    is_raw = b"<w:blocks" in block_bytes[:4096]
    if is_raw:
        inner = block_bytes[block_bytes.find(b">", block_bytes.find(b"<w:blocks")) + 1:
                             block_bytes.rfind(b"</w:blocks>")]
    else:
        block = etree.fromstring(block_bytes)
        doc = etree.fromstring(entries["word/document.xml"])
        body = doc.find(f"{{{W}}}body")

    # 新增关系 + 拷贝 media + 补 Content-Type
    PKG_R = "http://schemas.openxmlformats.org/package/2006/relationships"
    CT = "http://schemas.openxmlformats.org/package/2006/content-types"
    rels = etree.fromstring(entries["word/_rels/document.xml.rels"])
    used_ids = {r.get("Id") for r in rels}
    existing_media = {n.split("/")[-1] for n in entries if n.startswith("word/media/")}
    ct_exts = {d.get("Extension").lower() for d in
               etree.fromstring(entries["[Content_Types].xml"]).findall(f"{{{CT}}}Default")}
    CT_MAP = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
              ".gif": "image/gif", ".bmp": "image/bmp", ".tif": "image/tiff",
              ".tiff": "image/tiff", ".emf": "image/x-emf", ".wmf": "image/x-wmf"}
    rid_map = {}
    for old, info in rels_info.items():
        new = old
        while new in used_ids:
            new = new + "x"
        used_ids.add(new)
        rid_map[old] = new
        attrs = {"Id": new, "Type": info["type"], "Target": info["target"]}
        if info["external"]:
            attrs["TargetMode"] = "External"
        else:
            media_file = cover_dir / f"{prefix}_media" / f"{old}{Path(info['target']).suffix}"
            if media_file.is_file():
                fname = f"{prefix}_" + Path(info["target"]).name
                while fname in existing_media:
                    fname = f"{prefix}_" + fname
                existing_media.add(fname)
                entries[f"word/media/{fname}"] = media_file.read_bytes()
                attrs["Target"] = "media/" + fname
                ext = Path(info["target"]).suffix.lower()
                if ext not in ct_exts and ext in CT_MAP:
                    ct = etree.fromstring(entries["[Content_Types].xml"])
                    etree.SubElement(ct, f"{{{CT}}}Default",
                                     Extension=ext.lstrip("."), ContentType=CT_MAP[ext])
                    entries["[Content_Types].xml"] = etree.tostring(
                        ct, xml_declaration=True, encoding="UTF-8", standalone=True)
        etree.SubElement(rels, f"{{{PKG_R}}}Relationship", attrs)
    entries["word/_rels/document.xml.rels"] = etree.tostring(
        rels, xml_declaration=True, encoding="UTF-8", standalone=True)

    # 重映射片段中的 rId（raw 模式走字符串替换，其余字节不动）
    if is_raw:
        inner = re.sub(rb'((?:r:(?:embed|link|id|pict|dm|lo|qs|cs)|w:data)=")(rId\d+)(")',
                       lambda m: m.group(1) + rid_map.get(m.group(2).decode(), m.group(2)).encode()
                       + m.group(3), inner)
    else:
        for e in block.iter():
            for k, v in list(e.attrib.items()):
                if k in RID_ATTRS and v in rid_map:
                    e.set(k, rid_map[v])

    if is_raw:
        doc_xml = entries["word/document.xml"]
        # 块里用到的前缀必须在产物根上有声明，否则 unbound prefix → Word 报损坏。
        # 把 <w:blocks> 上携带的 xmlns 声明补进产物 <w:document> 根元素。
        head_end = block_bytes.find(b">", block_bytes.find(b"<w:blocks")) + 1
        decls = re.findall(rb'xmlns:[A-Za-z0-9_.-]+="[^"]*"', block_bytes[:head_end])
        rs = doc_xml.find(b"<w:document")
        re_ = doc_xml.find(b">", rs)
        have = {d.split(b"=")[0] for d in
                re.findall(rb'xmlns:[A-Za-z0-9_.-]+="[^"]*"', doc_xml[rs:re_ + 1])}
        add = [d for d in decls if d.split(b"=")[0] not in have]
        if add:
            doc_xml = doc_xml[:re_] + b" " + b" ".join(add) + doc_xml[re_:]
        PAGEBREAK = (b'<w:p><w:pPr><w:rPr><w:rFonts w:hint="eastAsia"/></w:rPr></w:pPr>'
                     b'<w:r><w:rPr><w:rFonts w:hint="eastAsia"/></w:rPr>'
                     b'<w:br w:type="page"/></w:r></w:p>')
        if at == "end":
            body_end = doc_xml.rfind(b"</w:body>")
            payload = PAGEBREAK + inner
        else:
            body_start = doc_xml.find(b">", doc_xml.find(b"<w:body")) + 1
            has_break = re.search(rb'<w:br\b[^>]*w:type="page"', inner) is not None
            payload = inner if has_break else inner + PAGEBREAK
            doc_xml = doc_xml[:body_start] + payload + doc_xml[body_start:]
            entries["word/document.xml"] = doc_xml
            payload = None
        if payload is not None:
            doc_xml = doc_xml[:body_end] + payload + doc_xml[body_end:]
            entries["word/document.xml"] = doc_xml
        tmp = docx_path.with_suffix(".tmp.docx")
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
            for name, data in entries.items():
                z.writestr(name, data)
        tmp.replace(docx_path)
        return docx_path

    frag = list(block)
    if at == "end":
        br = etree.fromstring(f'<w:p xmlns:w="{W}"><w:r><w:br w:type="page"/></w:r></w:p>')
        frag.insert(0, br)
        for el in frag[1:]:  # 去内嵌 sectPr（避免截断正文节）
            ppr = el.find(f"{{{W}}}pPr")
            if ppr is not None:
                sp = ppr.find(f"{{{W}}}sectPr")
                if sp is not None:
                    ppr.remove(sp)
        sect = body.find(f"{{{W}}}sectPr")
        idx = list(body).index(sect) if sect is not None else len(list(body))
        for i, el in enumerate(frag):
            body.insert(idx + i, el)
    else:
        has_break = any(b.get(f"{{{W}}}type") == "page"
                        for el in frag for b in el.findall(f".//{{{W}}}br"))
        if not has_break:
            br = etree.fromstring(f'<w:p xmlns:w="{W}"><w:r><w:br w:type="page"/></w:r></w:p>')
            frag.append(br)
        for i, el in enumerate(frag):
            body.insert(i, el)

    entries["word/document.xml"] = etree.tostring(
        doc, xml_declaration=True, encoding="UTF-8", standalone=True)
    tmp = docx_path.with_suffix(".tmp.docx")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in entries.items():
            z.writestr(name, data)
    tmp.replace(docx_path)
    return docx_path


def inject_cover(docx_path: Path, cover_dir: Path) -> Path:
    """把封面块注入 docx 开头（重映射 rId、拷贝 media、补分页符）。"""
    return _inject_block(docx_path, cover_dir, "cover", "start")


def inject_tail(docx_path: Path, tail_dir: Path) -> Path:
    """把尾部评分表块注入 docx 末尾（前置分页符）。"""
    return _inject_block(docx_path, tail_dir, "tail", "end")


# ---------------------------------------------------------------- 模板复刻

def _base_entry(numbering: str) -> dict:
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    base = next((t for t in cfg["templates"] if t.get("heading_numbering") == numbering), None)
    if not base:
        raise SystemExit(f"没有 heading_numbering={numbering} 的基础模板")
    return base


def clone_template(source_docx: str | Path, new_id: str, marker: str | None = "摘要",
                   numbering: str = "gongke", display_name: str | None = None,
                   register: bool = True) -> dict:
    """从一份现成 docx 反向复刻模板：格式层(reference.docx) + 封面块 + 注册。

    register=False 时只生成 templates/<new_id>/ 资产，不写 templates.json。"""
    import yaml
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    src = Path(source_docx).expanduser().resolve()
    if not src.is_file():
        raise SystemExit(f"源 docx 不存在: {src}")
    if not re.fullmatch(r"[\w-]+", new_id):
        raise SystemExit(f"非法模板 id: {new_id}")
    if register:
        cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
        exist = next((t for t in cfg["templates"] if t["id"] == new_id), None)
        if exist and exist.get("source") != "derived":
            raise SystemExit(f"模板已存在且非派生模板，拒绝覆盖: {new_id}")

    tdir = WORDEDITOR_ROOT / "templates" / new_id
    if tdir.exists():
        shutil.rmtree(tdir)
    tdir.mkdir(parents=True)

    # 1) 格式层：源 docx 整个作为 reference.docx（styles + 页面 + 页眉页脚）
    ref = tdir / "reference.docx"
    shutil.copy2(src, ref)

    # 2) 封面块 + 尾部评审表块
    cover = extract_cover(src, marker, tdir)
    tail = extract_tail(src, tdir)

    # 3) 最小 styles.yaml：只要列表样式库 + 多级编号（内容样式全部来自 reference.docx）
    base = _base_entry(numbering)
    from postprocess_styles import load_dsl
    base_dsl = load_dsl(WORDEDITOR_ROOT / base["styles_yaml"])
    mini = {"template": {"id": new_id, "name": display_name or new_id}}
    for k in ("default_list_style", "use_list_styles", "multilevel_list"):
        if k in base_dsl:
            mini[k] = base_dsl[k]

    # 3.5) 关键：multilevel_list.heading_style 官方约定 styleId "1".."4" = heading 1..4，
    #      克隆文档 styleId 布局不同，必须按样式名重映射，否则编号会挂到 Normal 上
    import zipfile as _zf
    with _zf.ZipFile(ref) as _z:
        _styles_root = etree.fromstring(_z.read("word/styles.xml"))
    sys.path.insert(0, str(_PIPE_DIR))
    from ooxml_util import resolve_heading_style_ids
    hid = resolve_heading_style_ids(_styles_root)   # level(名字 heading N) -> styleId
    for i, lv in enumerate(mini.get("multilevel_list", {}).get("levels", [])):
        want = i + 1                                # 官方: ilvl i -> heading i+1
        if want in hid:
            lv["heading_style"] = hid[want]
        else:
            print(f"⚠ 克隆文档缺 heading {want} 样式，该级编号可能不显示")
    (tdir / "styles.yaml").write_text(
        "# 由 clone_template 反向复刻生成（内容样式来自 reference.docx，勿手改 overrides）\n"
        + yaml.safe_dump(mini, allow_unicode=True, sort_keys=False), encoding="utf-8")

    # 4) 注册
    entry = {
        "id": new_id, "name": display_name or new_id, "standalone": True,
        "heading_numbering": numbering,
        "reference_doc": f"templates/{new_id}/reference.docx",
        "lua_filter": base["lua_filter"],
        "extra_lua_filters": base.get("extra_lua_filters", []),
        "styles_yaml": f"templates/{new_id}/styles.yaml",
        "three_line_tables": True, "source": "derived",
        "cover_block": f"templates/{new_id}/cover_block.xml",
        "note": f"反向复刻自 {src.name}（封面块 {cover['elements']} 元素"
                + (f" + 尾部评审表块 {tail['elements']} 元素" if tail else "") + "）",
    }
    if tail:
        entry["tail_block"] = f"templates/{new_id}/tail_block.xml"
    if register:
        cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
        exist = next((t for t in cfg["templates"] if t["id"] == new_id), None)
        if exist:
            exist.update(entry)
        else:
            cfg["templates"].append(entry)
        CONFIG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"template_id": new_id, "styles_yaml": str(tdir / "styles.yaml"),
            "cover": cover, "tail": tail, "registered": register}


def remove_clone(new_id: str) -> bool:
    """删除复刻模板（templates.json 条目 + templates/<id>/ 资产）。"""
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    if not any(t["id"] == new_id for t in cfg["templates"]):
        return False
    cfg["templates"] = [t for t in cfg["templates"] if t["id"] != new_id]
    CONFIG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    shutil.rmtree(WORDEDITOR_ROOT / "templates" / new_id, ignore_errors=True)
    return True


def uuid_hex() -> str:
    import uuid
    return uuid.uuid4().hex[:8]


# ---------------------------------------------------------------- CLI

if __name__ == "__main__":
    argv = sys.argv[1:]
    if not argv:
        print(__doc__)
        raise SystemExit(0)
    cmd = argv[0]
    if cmd == "analyze" and len(argv) >= 2:
        rep = analyze_docx(argv[1])
        print(json.dumps(rep, ensure_ascii=False, indent=1))
    elif cmd == "clone" and len(argv) >= 3:
        src, nid = argv[1], argv[2]
        marker, numbering, name = "摘要", "gongke", None
        rest = argv[3:]
        for flag, val in zip(rest[::2], rest[1::2]):
            if flag == "--marker":
                marker = val
            elif flag == "--numbering":
                numbering = val
            elif flag == "--name":
                name = val
        rep = clone_template(src, nid, marker=marker, numbering=numbering, display_name=name)
        print(json.dumps(rep, ensure_ascii=False, indent=1))
    elif cmd == "remove" and len(argv) >= 2:
        print("已删除" if remove_clone(argv[1]) else "不存在")
    else:
        print(__doc__)
        raise SystemExit(1)
