"""从用户提供的 .docx 模板中抽取「主正文节」(Section 1)，生成 Pandoc 可用的 reference.docx。

用户原模板第 0 节是封面/目录（页脚 "II" 罗马数字），第 1 节才是正文（页脚「第N页/共M页」+ 3.17/2.54 边距）。
Pandoc --reference-doc 会保留 reference.docx 里的 w:body 最后一个 w:sectPr 和它引用的 header/footer，
但因封面节占据了 w:body 多数空间，会带来奇怪行为；最干净的方案是把 reference.docx 改造为「只剩 Section 1」。

做法：
  1. 解压用户 docx
  2. 解析 word/document.xml：删除所有正文段落，只在 body 里留一个空段落 + Section 1 的 sectPr
  3. 删除 Section 0 引用的 header/footer 关系（保留 Section 1 的）
  4. 不动 styles.xml / numbering.xml / theme*.xml，全部样式保留
  5. 重新打包写回 reference.docx
"""
from __future__ import annotations

import argparse
import shutil
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL_PKG_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
ET.register_namespace("w", W_NS)
ET.register_namespace("r", R_NS)
# 注意：rels / [Content_Types].xml 各有「默认命名空间」，但 ElementTree 只能注册一个空前缀；
# 因此用 tostring(default_namespace=...) 在序列化时按文件指定。


def qn(tag: str, ns: str = W_NS) -> str:
    return f"{{{ns}}}{tag}"


def strip_to_last_section(src: Path, dst: Path) -> None:
    """打开 src docx，重写 document.xml 让它只剩最后一个 section（含其 sectPr + 一个空段落）。"""
    if dst.exists():
        dst.unlink()
    # 先复制全部内容
    shutil.copyfile(src, dst)

    # 读 document.xml
    with zipfile.ZipFile(dst, "r") as zin:
        doc_xml = zin.read("word/document.xml")
        rels_xml = zin.read("word/_rels/document.xml.rels")
        names = zin.namelist()

    root = ET.fromstring(doc_xml)
    body = root.find(qn("body"))
    assert body is not None

    # 找出所有 sectPr：内联在段落里的 + body 末尾的
    inline_sectprs = []  # (paragraph_element, sectPr_element)
    for p in body.findall(qn("p")):
        ppr = p.find(qn("pPr"))
        if ppr is not None:
            sp = ppr.find(qn("sectPr"))
            if sp is not None:
                inline_sectprs.append((p, sp))
    final_sectpr = body.find(qn("sectPr"))

    # 收集所有 sectPr 引用到的 header/footer rId
    def collect_refs(sp):
        refs = set()
        for tag in ("headerReference", "footerReference"):
            for ref in sp.findall(qn(tag)):
                rid = ref.get(qn("id", R_NS))
                if rid:
                    refs.add(rid)
        return refs

    keep_refs = collect_refs(final_sectpr) if final_sectpr is not None else set()

    # 清空 body：删掉所有元素
    for child in list(body):
        body.remove(child)

    # 插入一个空段落（Pandoc 会替换 body 内容，但需要至少有节属性）
    p = ET.SubElement(body, qn("p"))
    # 在最后插入 final sectPr
    if final_sectpr is not None:
        body.append(final_sectpr)

    new_doc_xml = b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + ET.tostring(root, encoding="utf-8")

    # 处理 rels：删除非 keep_refs 引用的 header/footer 关系（避免 Office 校验告警，但即使不删也不影响 Pandoc）
    rels_root = ET.fromstring(rels_xml)
    REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
    HF_TYPES = {
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer",
    }
    to_remove_targets = []  # 文件内路径
    for rel in list(rels_root):
        rid = rel.get("Id")
        rtype = rel.get("Type")
        target = rel.get("Target")
        if rtype in HF_TYPES and rid not in keep_refs:
            to_remove_targets.append(f"word/{target}")
            rels_root.remove(rel)
    # ElementTree 会把默认命名空间变成 ns0；手工复原为默认 xmlns
    raw = ET.tostring(rels_root, encoding="utf-8")
    raw = raw.replace(b'xmlns:ns0="%s"' % REL_PKG_NS.encode(), b'xmlns="%s"' % REL_PKG_NS.encode())
    raw = raw.replace(b'<ns0:', b'<').replace(b'</ns0:', b'</')
    new_rels_xml = b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + raw

    # 同步更新 [Content_Types].xml：移除被删 header/footer 的 Override
    with zipfile.ZipFile(dst, "r") as zin:
        ct_xml = zin.read("[Content_Types].xml")
    ct_root = ET.fromstring(ct_xml)
    for ov in list(ct_root):
        if ov.tag.endswith("}Override"):
            partname = ov.get("PartName", "").lstrip("/")
            if partname in to_remove_targets:
                ct_root.remove(ov)
    raw = ET.tostring(ct_root, encoding="utf-8")
    raw = raw.replace(b'xmlns:ns0="%s"' % CT_NS.encode(), b'xmlns="%s"' % CT_NS.encode())
    raw = raw.replace(b'<ns0:', b'<').replace(b'</ns0:', b'</')
    new_ct_xml = b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + raw

    # 重写 zip
    tmp = dst.with_suffix(".tmp.docx")
    with zipfile.ZipFile(dst, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for name in zin.namelist():
            if name in to_remove_targets:
                continue
            if name == "word/document.xml":
                zout.writestr(name, new_doc_xml)
            elif name == "word/_rels/document.xml.rels":
                zout.writestr(name, new_rels_xml)
            elif name == "[Content_Types].xml":
                zout.writestr(name, new_ct_xml)
            else:
                zout.writestr(name, zin.read(name))
    tmp.replace(dst)
    print(f"[reference] 已生成 {dst} (移除 header/footer 文件 {len(to_remove_targets)} 个，保留 rId={sorted(keep_refs)})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="templates/hutb-carbon-neutral/_user-template.docx")
    ap.add_argument("--dst", default="templates/hutb-carbon-neutral/reference.docx")
    args = ap.parse_args()
    strip_to_last_section(Path(args.src), Path(args.dst))
