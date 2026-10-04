"""块边界自动探测：封面 / 尾页评分表切到哪里，由信号决定，不人肉数索引。"""
import re
from pathlib import Path

from clone_core import TAIL_MARKERS  # noqa: E402  尾部识别词唯一来源在底座模块
from .ooxml import W, _body_children, _has_page_break, _local, _para_text

_COVER_LABELS = ("题目", "学院", "专业", "班级", "学号", "学生姓名", "姓名", "指导教师",
                 "教师", "职称", "课程名称", "完成时间", "单位", "日期")

_HEADING_NAME_RE = re.compile(r"^(title|heading\s*\d+|标题\s*\d+)", re.I)

def _tbl_label_hits(tbl) -> list[str]:
    """表格里命中的封面信息标签（按出现顺序去重）。"""
    hits = []
    for t in tbl.iter(f"{{{W}}}t"):
        txt = t.text or ""
        for lab in _COVER_LABELS:
            if lab in txt and lab not in hits:
                hits.append(lab)
    return hits

def _cover_signature(children, names):
    """封面表格签名策略：全 body 找「含 ≥2 个封面信息标签的表格」。

    封面不一定在第一页（规范类文档封面常夹在中段），表格标签是最稳信号。
    扩展规则（按两个真实模板校准）：
      向前收：空段 / 短文本段（<20 字且不含冒号）/ 图片段 / 书签；遇长段落、
              含「：」的段落或分页段停 —— 那是规范说明的正文。
      向后收：空段 / 日期段（含「年…月」「月…日」）/ 分页段 / 书签；
              遇第一个非空且非日期的段落停 —— 那是正文开头（至多扫 8 段）。
    """
    for i, el in enumerate(children):
        if _local(el) != "tbl":
            continue
        hits = _tbl_label_hits(el)
        if len(hits) < 2:
            continue
        start = i
        for j in range(i - 1, -1, -1):
            prev = children[j]
            loc = _local(prev)
            if loc == "tbl" or _has_page_break(prev):
                break
            t = _para_text(prev)
            if loc == "p" and (len(t) >= 20 or "：" in t or ":" in t):
                break
            start = j                      # 空段/短段/图片段/书签都收
        end = i + 1
        for j in range(i + 1, min(i + 9, len(children))):
            nxt = children[j]
            loc = _local(nxt)
            if loc == "tbl":
                break
            if loc != "p":                 # bookmarkStart/End 等透明元素
                end = j + 1
                continue
            t = _para_text(nxt)
            if not t:
                end = j + 1
                if _has_page_break(nxt):
                    break
                continue
            if re.search(r"\d{4}\s*年|年\s*月|月\s*日", t):
                end = j + 1                # 日期段收下后继续
                continue
            break                          # 第一个非空非日期段 = 正文开头
        if end > start:
            return {"slice": [start, end], "strategy": "cover_table",
                    "evidence": f"index {i} 表格含封面信息标签 {hits}"}
    return None

def detect_cover(children, names, marker: str | None = None, min_body_len: int = 100):
    """自动判定封面块 = body[start, end)。

    策略优先级（先整体扫一遍高优先级信号，命中即返回）：
      1. marker      —— 第一个含 marker 文本的段落（不含该段）
      2. cover_table —— 全 body 找含 ≥2 个封面信息标签（题目/学院/学号…）的表格，
                        前后扩到边界。**封面不必在第一页**，此策略兜住规范类文档。
      3. style       —— 第一个 Title / Heading N 样式段落（不含该段）
      4. page_break  —— 第一个含 <w:br w:type=page> 的段落（**含**该段，它是封面自带分页）
      5. long_para   —— 第一个长度 ≥ min_body_len 的段落（正文信号，不含该段）
    """
    def probe(kind):
        for i, el in enumerate(children):
            if _local(el) != "p":
                continue
            txt = _para_text(el)
            if kind == "marker":
                if marker and marker in txt:
                    return 0, i, f"index {i} 段落含 marker {marker!r}"
            elif kind == "style":
                ps = el.find(f"{{{W}}}pPr/{{{W}}}pStyle")
                if ps is not None:
                    nm = names.get(ps.get(f"{{{W}}}val"), "")
                    if nm == "title" or _HEADING_NAME_RE.match(nm):
                        return 0, i, f"index {i} 段落样式为 {nm!r}"
            elif kind == "page_break":
                if _has_page_break(el):
                    return 0, i + 1, f"index {i} 段落含 <w:br w:type=page>（封面自带分页）"
            elif kind == "long_para":
                if len(txt) >= min_body_len:
                    return 0, i, f"index {i} 段落长度 {len(txt)} ≥ {min_body_len}（正文信号）"
        return None

    for kind in ((("marker",) if marker else ()) + ("cover_table", "style", "page_break", "long_para")):
        if kind == "cover_table":
            hit = _cover_signature(children, names)
            if hit and hit["slice"][1] > hit["slice"][0]:
                return hit
            continue
        hit = probe(kind)
        if hit:
            start, end, ev = hit
            if end > start:
                return {"slice": [start, end], "strategy": kind, "evidence": ev}
    return None

def detect_tail(children, after: int = 0):
    """自动判定尾页评分表块 = body[start, end)。

    规则：在 index > after（封面之后）的表格里选目标表——
      优先选「前 3 个非空段落里含 评审/评分/成绩/评语…」的最靠后一张；
      没有关键字就取最后一张表。
    然后从目标表向前扩（收标题段 / 分页段）、向后扩（收空段与短段）。
    """
    tbls = [i for i, el in enumerate(children) if _local(el) == "tbl" and i >= after]
    if not tbls:
        return None
    target, strategy, ev = tbls[-1], "last_table", "取封面之后最后一张表"
    for i in reversed(tbls):
        ctx = []
        j, n = i - 1, 0
        while j >= 0 and n < 3:
            if _local(children[j]) != "tbl":
                t = _para_text(children[j])
                if t:
                    ctx.append(t)
                    n += 1
            j -= 1
        head = "".join(ctx) + _para_text(children[i])
        hit = next((m for m in TAIL_MARKERS if m in head), None)
        if hit:
            target, strategy = i, "table+marker"
            ev = f"index {i} 表格（前接文本含关键字 {hit!r}）"
            break

    # 向前扩：收标题段 / 分页段，遇到正文段或另一张表即停
    start, i = target, target - 1
    while i >= after:
        el = children[i]
        if _local(el) == "tbl":
            break
        if _has_page_break(el):
            start = i
            break
        txt = _para_text(el)
        if not txt:
            i -= 1
            continue
        if any(m in txt for m in TAIL_MARKERS):
            start = i
            i -= 1
            continue
        break
    # 向后扩：只收空段与短段（表后备注/空行），遇实质段落或另一张表即停
    end, j = target + 1, target + 1
    while j < len(children):
        el = children[j]
        if _local(el) == "tbl":
            break
        txt = _para_text(el)
        if not txt or len(txt) < 40:
            end = j + 1
            j += 1
            continue
        break
    return {"slice": [start, end], "strategy": strategy, "evidence": ev, "table_index": target}

def detect_blocks(src_docx: Path, marker: str | None = None) -> dict:
    """一次跑完封面 + 尾表探测，输出可直接填进 spec 的事实（含依据，供人工核对）。"""
    children, names = _body_children(src_docx)
    cover = detect_cover(children, names, marker)
    out = {
        "source": str(src_docx),
        "body_elements": len(children),
        "cover": None,
        "tail": None,
    }
    if cover:
        s, e = cover["slice"]
        texts = [_para_text(el) for el in children[s:e] if _local(el) == "p"]
        texts = [t for t in texts if t]
        tbl = next((children[i] for i in range(s, e) if _local(children[i]) == "tbl"), None)
        out["cover"] = {
            **cover,
            "elements": e - s,
            "has_page_break": any(_has_page_break(el) for el in children[s:e]),
            "has_table": tbl is not None,
            "first_text": texts[0] if texts else "",
            "last_text": texts[-1] if texts else "",
        }
    tail = detect_tail(children, after=cover["slice"][1] if cover else 0)
    if tail:
        s, e = tail["slice"]
        t = children[tail["table_index"]]
        rows = len(t.findall(f"{{{W}}}tr"))
        grid = t.find(f"{{{W}}}tblGrid")
        cols = len(grid) if grid is not None else 0
        title = next((_para_text(el) for el in children[s:tail["table_index"]]
                      if _local(el) == "p" and _para_text(el)), "")
        out["tail"] = {
            **tail,
            "elements": e - s,
            "title": title,
            "rows": rows,
            "cols": cols,
            "has_page_break": any(_has_page_break(el) for el in children[s:e]),
        }
    return out

