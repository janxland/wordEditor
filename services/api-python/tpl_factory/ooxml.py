"""最底层 OOXML 读写原语：元素工具 / body 解析 / 字节级顶层扫描。被其余模块依赖，自身零依赖。"""
import re
from pathlib import Path

from clone_core import _load_parts  # noqa: E402  与本包同目录的兄弟模块

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

def _local(el) -> str:
    return el.tag.split("}")[-1]

def _para_text(el) -> str:
    return "".join(t.text or "" for t in el.iter(f"{{{W}}}t")).strip()

def _has_page_break(el) -> bool:
    return any(b.get(f"{{{W}}}type") == "page" for b in el.iter(f"{{{W}}}br"))

def _style_names(styles) -> dict[str, str]:
    """styleId -> 样式显示名（小写）。"""
    out = {}
    if styles is None:
        return out
    for s in styles.findall(f"{{{W}}}style"):
        sid = s.get(f"{{{W}}}styleId")
        nm = s.find(f"{{{W}}}name")
        if sid and nm is not None:
            out[sid] = (nm.get(f"{{{W}}}val") or "").lower()
    return out

def _body_children(src_docx: Path):
    """body 顶层元素（排除结尾 sectPr），作为切片索引空间。"""
    doc, styles, _rels = _load_parts(src_docx)
    body = doc.find(f"{{{W}}}body")
    children = [el for el in body if _local(el) != "sectPr"]
    return children, _style_names(styles)

# 字节级 body 扫描：直接切原始 XML，绝不 parse→serialize ——
# 序列化会丢 proofErr/注释/PI、重写属性顺序，nsmap 只按首元素继承
# → 前缀未绑定 = Word 报文档损坏。原样切字节则 0 丢失。
_TAG_OPEN = re.compile(rb"<([A-Za-z_][A-Za-z0-9_.:-]*)")

def _open_tag_end(seg: bytes, i: int) -> int:
    """从 '<' 处开始，跳过引号内内容，返回开标签 '>' 的下标。"""
    j = i
    n = len(seg)
    while j < n:
        c = seg[j:j + 1]
        if c in (b'"', b"'"):
            q = c
            j += 1
            while j < n and seg[j:j + 1] != q:
                j += 1
        elif c == b">":
            return j
        j += 1
    return -1

def iter_body_top_level(raw: bytes):
    """在 w:body 内按字节扫描，逐个 yield 顶层元素 (name, start, end)。

    顶层判定靠配对消耗：读到 w:tbl 就一路吃到 </w:tbl>，其内部 w:p 不算顶层。
    """
    b = raw.find(b"<w:body")
    if b == -1:
        raise SystemExit("document.xml 里找不到 <w:body>")
    b = raw.find(b">", b) + 1
    e = raw.rfind(b"</w:body>")
    if e == -1:
        raise SystemExit("document.xml 里找不到 </w:body>")
    seg = raw[b:e]
    i = 0
    n = len(seg)
    while True:
        lt = seg.find(b"<", i)
        if lt == -1:
            return
        m = _TAG_OPEN.match(seg, lt)
        if not m:                      # 注释 / PI / CDATA
            if seg.startswith(b"<!--", lt):
                i = seg.find(b"-->", lt) + 3
            elif seg.startswith(b"<?", lt):
                i = seg.find(b"?>", lt) + 2
            else:
                i = lt + 1
            continue
        name = m.group(1)
        gt = _open_tag_end(seg, lt)
        if gt == -1:
            return
        if seg[gt - 1:gt] == b"/":     # 自闭合
            yield (name.decode(), b + lt, b + gt + 1)
            i = gt + 1
            continue
        close = re.compile(rb"</" + re.escape(name) + rb"\s*>").search(seg, gt)
        if not close:
            return
        yield (name.decode(), b + lt, b + close.end())
        i = close.end()

_RID_ATTR_B = re.compile(
    rb'((?:r:(?:embed|link|id|pict|dm|lo|qs|cs)|w:data)=")(rId\d+)(")')

