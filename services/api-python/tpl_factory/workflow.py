"""子命令编排：build / check / analyze / text / fields / run / init。"""
import json
import re
import shutil
import sys
from pathlib import Path

from .assets import register, write_web_assets
from clone_core import _load_parts  # noqa: E402  同目录兄弟模块
from .detect import detect_blocks
from .ooxml import W, _body_children, _local, _para_text
from .reference import build_reference_cloned
from .slices import slice_block
from .spec import _SPEC_TEMPLATE, load_spec
from .styles_yaml import render_styles_yaml

_FIELD_KEY_MAP = {"题目": "title", "学院": "college", "专业": "major", "班级": "class_name",
                  "学号": "student_id", "学生姓名": "student_name", "姓名": "student_name",
                  "指导教师": "teacher", "教师": "teacher", "职称": "academic_title",
                  "课程名称": "course", "完成时间": "date", "日期": "date", "单位": "unit"}

def build(spec_path: str | Path, do_register: bool = True) -> dict:
    spec_path = Path(spec_path).resolve()
    spec = load_spec(spec_path)
    tpl_dir = spec_path.parent
    src = Path(spec["source_docx"]).expanduser()
    if not src.is_file():
        raise SystemExit(f"源 docx 不存在: {src}")

    result: dict = {"id": spec["id"], "dir": str(tpl_dir)}

    # 封面 / 尾表切片：slice 可写 "auto"（工具自动探测边界）或 [start, end)（探测不准时人工覆盖）
    det = detect_blocks(src, marker=spec.get("marker"))
    for key, prefix in (("cover", "cover"), ("tail", "tail")):
        cfg = spec.get(key) or {}
        sl = cfg.get("slice", "auto")
        if sl is None or str(sl) == "auto":
            d = det.get(key)
            if not d:
                raise SystemExit(
                    f"未能自动探测 {key} 块；请先用 detect 查看 body 结构，再在 spec.{key}.slice 写显式索引")
            start, end = d["slice"]
            extra = {"mode": "auto", "strategy": d["strategy"], "evidence": d["evidence"]}
        else:
            start, end = int(sl[0]), int(sl[1])
            extra = {"mode": "explicit"}
        info = slice_block(src, start, end, prefix, tpl_dir)
        info.update(extra)
        result[key] = info

    # reference.docx 一律「整包克隆源 docx」（铁律 1.5）：docDefaults / theme /
    # settings / sectPr 全部沿用源，封面渲染才与源一致。
    # from_scratch 分支已被反向验证证伪（封面 20+74 段被强加行距 + ja-JP 日文字体），已删除。
    result["reference"] = str(tpl_dir / "reference.docx")
    result["reference_clone"] = build_reference_cloned(
        spec, src, tpl_dir / "reference.docx")
    result["styles"] = str(render_styles_yaml(spec, tpl_dir / "styles.yaml"))
    result["web_assets"] = [str(p) for p in write_web_assets(spec, tpl_dir)]

    if do_register:
        result["registered"] = register(spec)
    return result

def check(spec_path: str | Path) -> dict:
    """只校验切片命中的元素是否符合预期（不写产物）。"""
    spec = load_spec(spec_path)
    src = Path(spec["source_docx"]).expanduser()
    doc, _s, _r = _load_parts(src)
    body = doc.find(f"{{{W}}}body")
    children = list(body)

    def preview(start: int, end: int):
        def txt(el):
            return "".join(x.text or "" for x in el.iter(f"{{{W}}}t")).strip()
        items = []
        for i in range(start, end):
            el = children[i]
            tag = el.tag.split("}")[1]
            if tag == "tbl":
                items.append(f"[{i}] <tbl rows={len(el.findall(f'{{{W}}}tr'))}>")
            elif tag == "p":
                mark = ""
                if el.find(f".//{{{W}}}drawing") is not None:
                    mark += " [图]"
                if any(b.get(f"{{{W}}}type") == "page" for b in el.findall(f".//{{{W}}}br")):
                    mark += " [分页]"
                items.append(f"[{i}] <p> {txt(el)[:36]!r}{mark}")
            else:
                items.append(f"[{i}] <{tag}>")
        return items

    out = {"body_len": len(children)}
    for key in ("cover", "tail"):
        sl = (spec.get(key) or {}).get("slice")
        if sl is None or str(sl) == "auto":
            d = detect_blocks(src, marker=spec.get("marker")).get(key)
            if not d:
                out[key] = {"error": "自动探测失败，需显式指定 slice"}
                continue
            sl = d["slice"]
            out[key] = {"slice": sl, "strategy": d["strategy"], "evidence": d["evidence"],
                        "preview": preview(sl[0], sl[1])}
        else:
            out[key] = {"slice": list(sl), "preview": preview(int(sl[0]), int(sl[1]))}
    return out

def analyze(src_docx: str | Path) -> dict:
    """解剖一份源 docx，输出填 spec.yaml 所需的全部事实（只读，不写产物）。

    Agent 拿到这份报告即可直接写 spec：body 索引决定 cover/tail 切片边界，
    section 决定 page 段，正文/标题段落的实测值决定 body/headings/title 段。
    """
    src = Path(src_docx).expanduser()
    doc, styles, _rels = _load_parts(src)
    body = doc.find(f"{{{W}}}body")
    children = list(body)

    def ptxt(el):
        return "".join(x.text or "" for x in el.iter(f"{{{W}}}t")).strip()

    def rpr_of(p):
        """段落首个 run 的字体/字号/加粗（模板多用直接格式，不建样式）。"""
        r = p.find(f"{{{W}}}r")
        if r is None:
            return None
        rp = r.find(f"{{{W}}}rPr")
        if rp is None:
            return None
        f = rp.find(f"{{{W}}}rFonts")
        sz = rp.find(f"{{{W}}}sz")
        return {
            "cjk": f.get(f"{{{W}}}eastAsia") if f is not None else None,
            "latin": f.get(f"{{{W}}}ascii") if f is not None else None,
            "sz": sz.get(f"{{{W}}}val") if sz is not None else None,
            "bold": rp.find(f"{{{W}}}b") is not None,
        }

    def ppr_of(p):
        pr = p.find(f"{{{W}}}pPr")
        if pr is None:
            return {}
        out = {}
        jc = pr.find(f"{{{W}}}jc")
        if jc is not None:
            out["jc"] = jc.get(f"{{{W}}}val")
        ind = pr.find(f"{{{W}}}ind")
        if ind is not None:
            out["ind"] = {k.split("}")[1]: v for k, v in ind.attrib.items()}
        sp = pr.find(f"{{{W}}}spacing")
        if sp is not None:
            out["spacing"] = {k.split("}")[1]: v for k, v in sp.attrib.items()}
        ps = pr.find(f"{{{W}}}pStyle")
        if ps is not None:
            out["pStyle"] = ps.get(f"{{{W}}}val")
        return out

    outline = []
    for i, el in enumerate(children):
        tag = el.tag.split("}")[1]
        if tag == "p":
            marks = []
            if el.find(f".//{{{W}}}drawing") is not None:
                marks.append("IMG")
            if any(b.get(f"{{{W}}}type") == "page" for b in el.findall(f".//{{{W}}}br")):
                marks.append("PAGEBREAK")
            row = {"i": i, "kind": "p", "text": ptxt(el)[:40]}
            if marks:
                row["marks"] = marks
            pr = ppr_of(el)
            if pr:
                row["pPr"] = pr
            rf = rpr_of(el)
            if rf:
                row["run"] = rf
            outline.append(row)
        elif tag == "tbl":
            grid = [g.get(f"{{{W}}}w") for g in el.find(f"{{{W}}}tblGrid")]
            tw = el.find(f"{{{W}}}tblPr/{{{W}}}tblW")
            ti = el.find(f"{{{W}}}tblPr/{{{W}}}tblInd")
            outline.append({"i": i, "kind": "tbl",
                            "rows": len(el.findall(f"{{{W}}}tr")),
                            "grid": grid, "grid_count": len(grid),
                            "width": tw.get(f"{{{W}}}w") if tw is not None else None,
                            "indent": ti.get(f"{{{W}}}w") if ti is not None else None,
                            "first_col": [ptxt(tc.find(f"{{{W}}}p"))
                                          for tc in el.findall(f"{{{W}}}tr/{{{W}}}tc")][:8]})
        else:
            outline.append({"i": i, "kind": tag})

    sect = doc.find(f".//{{{W}}}sectPr")
    def sg(tag):
        e = sect.find(f"{{{W}}}{tag}") if sect is not None else None
        return {k.split("}")[1]: v for k, v in e.attrib.items()} if e is not None else None

    return {
        "source": str(src),
        "body_len": len(children),
        "section": {"pgSz": sg("pgSz"), "pgMar": sg("pgMar"), "docGrid": sg("docGrid")},
        "docDefaults": _doc_defaults(styles),
        "outline": outline,
    }

def _doc_defaults(styles) -> dict:
    if styles is None:
        return {}
    dd = styles.find(f"{{{W}}}docDefaults")
    if dd is None:
        return {}
    rpr = dd.find(f"{{{W}}}rPrDefault/{{{W}}}rPr")
    if rpr is None:
        return {}
    f = rpr.find(f"{{{W}}}rFonts")
    return {"fonts": {k.split("}")[1]: v for k, v in f.attrib.items()} if f is not None else None,
            "styles_defined": len(styles.findall(f"{{{W}}}style"))}

def dump_text(src_docx: str | Path) -> dict:
    """全量输出 body 逐段完整文本（不截断）。识别格式要求（括号标注）专用，零判断。"""
    src = Path(src_docx).expanduser()
    doc, _styles, _rels = _load_parts(src)
    body = doc.find(f"{{{W}}}body")
    rows = []
    for i, el in enumerate(list(body)):
        tag = el.tag.split("}")[1]
        if tag == "p":
            txt = "".join(x.text or "" for x in el.iter(f"{{{W}}}t")).strip()
            if txt:
                rows.append({"i": i, "kind": "p", "text": txt})
        elif tag == "tbl":
            cells = ["".join(x.text or "" for x in tc.iter(f"{{{W}}}t")).strip()
                     for tc in el.findall(f"{{{W}}}tr/{{{W}}}tc")]
            rows.append({"i": i, "kind": "tbl", "rows": len(el.findall(f"{{{W}}}tr")),
                         "cells": cells})
    return {"source": str(src), "paras": rows}

def extract_fields(spec_path: str | Path) -> dict:
    """机械提取 cover.fields / tail.rubric：从源 docx 切片里把表格逐格读出来，
    生成可直接粘进 spec.yaml 的 YAML 片段。AI 只需核对语义，不再逐格手抄。"""
    spec = load_spec(spec_path)
    src = Path(spec["source_docx"])
    children, names = _body_children(src)
    det = detect_blocks(src)

    def resolve(which):
        sl = (spec.get(which) or {}).get("slice", "auto")
        if sl == "auto":
            hit = det.get(which)
            if not hit:
                raise SystemExit(f"{which}: slice=auto 且探测无结果")
            return hit["slice"]
        return sl

    out = {"cover_fields_yaml": [], "rubric_yaml": {}, "notes": []}

    # ---- cover.fields ----
    cs, ce = resolve("cover")
    tbl_i = next((i for i in range(cs, ce) if _local(children[i]) == "tbl"), None)
    if tbl_i is not None:
        rows = children[tbl_i].findall(f"{{{W}}}tr")
        for r, tr in enumerate(rows):
            cells = ["".join(t.text or "" for t in tc.iter(f"{{{W}}}t")).strip()
                     for tc in tr.findall(f"{{{W}}}tc")]
            label = next((c for c in cells if c), "")
            if not label:
                continue
            flat = label.replace(" ", "").replace("\u3000", "")
            key = next((v for lab, v in _FIELD_KEY_MAP.items() if lab in flat), f"field{r}")
            col = cells.index(label) + 1 if len(cells) > 1 else 0
            out["cover_fields_yaml"].append(
                f'    - {{key: "{key}", label: "{label}", row: {r}, col: {col}}}')
    # 封面切片里的日期段（年…月…日）
    for i in range(cs, ce):
        if _local(children[i]) == "p":
            t = _para_text(children[i])
            if re.search(r"\d{4}\s*年", t):
                out["cover_fields_yaml"].append(
                    f'    - {{key: "date", label: "日期", para: {i - cs}}}   # 切片内相对索引')
                break
    if not out["cover_fields_yaml"]:
        out["notes"].append("cover 切片内没有表格/日期段 → fields 保持 []")

    # ---- tail.rubric ----
    ts, te = resolve("tail")
    ttbl_i = next((i for i in range(ts, te) if _local(children[i]) == "tbl"), None)
    rub = {"grade_row": None, "remark_row": None, "signature_row": None, "other_rows": []}
    if ttbl_i is not None:
        for r, tr in enumerate(children[ttbl_i].findall(f"{{{W}}}tr")):
            first = "".join(t.text or "" for t in tr.iter(f"{{{W}}}t")).strip()
            if not first:
                continue
            if "成绩" in first or "评分等级" in first:
                rub["grade_row"] = first
            elif any(k in first for k in ("评语", "备注", "意见")):
                rub["remark_row"] = rub["remark_row"] or first
            elif "签名" in first:
                rub["signature_row"] = first
            else:
                rub["other_rows"].append(first)
    out["rubric_yaml"] = rub
    return out

def run_pipeline(spec_path: str | Path, md: str | None = None) -> dict:
    """一键跑通：build → 准备样例 MD → 真实构建 → template_verify。0 FAIL 才返回 ok=true。"""
    import subprocess
    spec_path = Path(spec_path).resolve()
    spec = load_spec(spec_path)
    tid = spec["id"]
    r_build = build(spec_path, do_register=True)

    root = Path(__file__).resolve().parents[3]  # tpl_factory/workflow.py → 仓库根
    sample = spec_path.parent / "sample.md"
    if md:
        sample = Path(md).expanduser().resolve()
    elif not sample.is_file():
        has_abs = bool(spec.get("abstract_styles"))
        sample.write_text(
            f"# {spec['name']}测试标题\n\n"
            + ("## 摘要\n\n这是一段测试摘要文本。\n\n**关键词**：测试；样例\n\n"
               if has_abs else "")
            + "## 一、一级标题测试\n\n这是正文段落，用于验证正文样式的落位与行距。\n\n"
              "### ㈠ 二级标题测试\n\n这是第二个正文段落。\n\n"
              "| 列一 | 列二 |\n|---|---|\n| 甲 | 乙 |\n",
            encoding="utf-8")
    out_docx = root / "output" / f"{tid}-sample.docx"
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # services/api-python
    from direct import build_to_workspace
    build_to_workspace(sample, tid, out_docx)

    vr = subprocess.run(
        [sys.executable, str(Path(__file__).resolve().parents[1] / "template_verify.py"),
         str(spec_path), str(out_docx)],
        capture_output=True, text=True)
    tail = (vr.stdout or vr.stderr).strip().splitlines()[-12:]
    return {
        "id": tid,
        "registered": r_build.get("registered", True),
        "sample_md": str(sample),
        "output": str(out_docx),
        "verify_returncode": vr.returncode,
        "verify_tail": tail,
        "ok": vr.returncode == 0,
    }

def init_template(src_docx: str | Path, tid: str, name: str, marker: str | None = None,
                  force: bool = False) -> dict:
    """脚手架：建 templates/<id>/，拷 source.docx，按源实测预填 spec.yaml，跑 detect。

    Agent 拿到后只需按 `text` 输出填 TODO（字号/fields/rubric），不再手写骨架。
    """
    src = Path(src_docx).expanduser().resolve()
    root = Path(__file__).resolve().parents[3]  # tpl_factory/workflow.py → 仓库根
    out_dir = root / "templates" / tid
    if out_dir.exists() and not force:
        raise SystemExit(f"templates/@TID@ 已存在，加 --force 覆盖（spec 会被重写！）")
    out_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, out_dir / "source.docx")

    a = analyze(src)
    sect = a.get("section") or {}
    pgsz, pgmar = sect.get("pgSz") or {}, sect.get("pgMar") or {}

    spec_text = (_SPEC_TEMPLATE
        .replace("@TID@", tid).replace("@NAME@", name).replace("@SRC_NAME@", src.name)
        .replace("@PAGE_W@", str(pgsz.get("w") or 11906)).replace("@PAGE_H@", str(pgsz.get("h") or 16838))
        .replace("@MAR_TOP@", str(pgmar.get("top") or 1440)).replace("@MAR_BOTTOM@", str(pgmar.get("bottom") or 1440))
        .replace("@MAR_LEFT@", str(pgmar.get("left") or 1800)).replace("@MAR_RIGHT@", str(pgmar.get("right") or 1800))
        .replace("@HEADER@", str(pgmar.get("header") or 851)).replace("@FOOTER@", str(pgmar.get("footer") or 992))
    )
    spec_path = out_dir / "spec.yaml"
    spec_path.write_text(spec_text, encoding="utf-8")

    det = detect_blocks(src, marker=marker)
    (out_dir / "detect-report.json").write_text(
        json.dumps(det, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "dir": str(out_dir),
        "spec": str(spec_path),
        "detect": det,
        "next": [
            f"$PY services/api-python/template_factory.py text {out_dir}/source.docx   # 全文，摘格式要求",
            "按 SKILL §4 映射字典填 spec.yaml 的 TODO（字号 / cover.fields / tail.rubric）",
            f"$PY services/api-python/template_factory.py check {spec_path}",
            f"$PY services/api-python/template_factory.py build {spec_path}",
            "构建测试 MD → build_to_workspace → template_verify.py，0 FAIL 结案（SKILL Step 5）",
        ],
    }

