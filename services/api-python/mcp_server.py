#!/Users/Admin1/.workbuddy/binaries/python/envs/default/bin/python
"""wordEditor MCP server —— 唯一连接器，构建 + 自然语言样式全覆盖（stdio）。

工具:
  - templates():                列出可用模板
  - build_docx(md_path, ...):   md/目录 → docx（工作区 = md 所在目录）
  - apply_style(workspace, spec, ...):  临时单次样式导出（不落持久状态）
  - save_style(name, spec):     保存命名临时样式（config/custom_styles/）
  - list_styles():              列出已存临时样式
  - save_template(new_id, ...): 固化为派生新模板（只新增）
  - remove_template(new_id):    删除派生模板（仅 source=derived）
  - analyze_docx(docx, ...):    只读解剖任意 docx（页面/样式/封面尾部边界）
  - clone_template(docx, ...):  反向复刻任意 docx 为可用模板（工厂全链路 + 0 FAIL 验收）

对接新学校的标准流程：analyze_docx → clone_template。
clone_template 会建脚手架、预填 spec、构建、跑真实样例并做 0 FAIL 验收；
返回的 TODO 清单里未由实测覆盖的项（字号/封面字段/评分指标）需按 text 报告补齐后重跑。

spec 由 Agent 从自然语言翻译（映射见 hutb-docx-export 技能 SKILL.md），例:
  {"title":{"font":"宋体","size":"小二","align":"center"}}

配置（~/.workbuddy/mcp.json，仅此一个条目）:
  "wordeditor": {
    "command": "<python>",
    "args": ["<wordEditor>/services/api-python/mcp_server.py"]
  }
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mcp.server.fastmcp import FastMCP

from direct import (  # noqa: E402
    DEFAULT_TEMPLATE_ID,  # 默认模板兜底值（config/templates.json:default_template 的最后一道兜底）
    build_to_workspace,
    list_templates,
)
from tpl_factory.detect import detect_blocks
from tpl_factory.workflow import (analyze as _factory_analyze,
                                  build, dump_text, init_template, run_pipeline)
import style_core
import clone_core

mcp = FastMCP(
    "wordeditor",
    instructions=(
        "wordEditor 论文导出（唯一连接器）：把 Markdown（含 images/ 等工作区图片）"
        "按湖南工商大学等模板渲染为 docx；支持自然语言样式覆盖。工作区 = MD 所在目录，"
        "产物默认回写该目录。普通导出用 build_docx；改样式用 apply_style（spec 字段: "
        "title/h1-h4/body/abstract/keywords/styles，属性 font(宋体|黑体|楷体|仿宋)、"
        "size(中文字号或pt)、align(左对齐|居中|两端对齐|left|center|both)、bold、"
        "line_spacing(单倍|1.5|22pt)、indent(字符)、numbering{fmt,font,size,align}）；"
        "复用样式用 save_style+list_styles；固化为新模板用 save_template，"
        "撤销用 remove_template（仅派生模板可删）。均不修改默认模板配置。"
        "【对接新学校】用户给一份学校官方 docx 要求适配时：先 analyze_docx 只读解剖，"
        "再 clone_template 反向复刻成模板（自动建脚手架+预填spec+构建+0FAIL验收），"
        "不要手写 reference.docx 或 styles.yaml。"
        "【接单区 vs 代码区】客户稿件一律放仓库根的 jobs/（inbox 来稿 / work 在建 / "
        "done 已交付），该目录被 .gitignore 整目录忽略；仓库的 input/ 是**代码自带的"
        "样例与回归输入，要入库**（尤其 input/暑假社会调查报告-样例.md 是产物等价回归的"
        "基线输入，别删别改）。客户稿件不要放进 input/，也不要把 jobs/ 里的东西提交进 git。"
    ),
)


@mcp.tool()
def templates() -> str:
    """列出 wordEditor 可用的论文导出模板（id、名称、说明、默认项）。"""
    lines = []
    for t in list_templates():
        star = "（默认）" if t["default"] else ""
        lines.append(f"- {t['id']}{star}: {t['name']} —— {t['note']}")
    return "\n".join(lines)


@mcp.tool()
def build_docx(md_path: str, template_id: str = DEFAULT_TEMPLATE_ID, output_path: str = "") -> str:
    """把 Markdown 按模板导出为 docx。

    md_path 可传 md 文件或工作区目录（目录时自动选取同名/唯一 md）。
    工作区 = md 所在目录；其下 images/、media/、charts/ 会随 md 一起打包。
    output_path 缺省时产物保存为 <工作区>/<md同名>.docx。
    返回产物绝对路径。"""
    out = build_to_workspace(
        md_path,
        template_id=template_id or DEFAULT_TEMPLATE_ID,
        output_path=output_path or None,
    )
    return str(out)


@mcp.tool()
def apply_style(workspace: str, spec: dict, template_id: str = DEFAULT_TEMPLATE_ID,
                output_path: str = "") -> str:
    """按自定义样式导出 docx（单次生效，不落持久状态、不改默认模板）。

    workspace=含主MD与images的文件夹；spec 见服务器 instructions 的映射；
    output_path 缺省时产物为 <工作区>/<MD同名>.docx。返回产物绝对路径。"""
    out = style_core.export_with_style(
        workspace, spec, template_id=template_id, output_path=output_path or None)
    return str(out)


@mcp.tool()
def save_style(name: str, spec: dict, template_id: str = DEFAULT_TEMPLATE_ID) -> str:
    """把样式 spec 保存为命名临时样式（config/custom_styles/<name>.yaml），供复用。"""
    return str(style_core.save_style(name, spec, template_id))


@mcp.tool()
def list_styles() -> str:
    """列出已保存的命名临时样式及其 spec。"""
    items = style_core.list_styles()
    if not items:
        return "（无已保存的临时样式）"
    return "\n".join(f"- {i['name']} (基模板 {i['template']}): "
                     f"{json.dumps(i['spec'], ensure_ascii=False)}" for i in items)


@mcp.tool()
def save_template(new_id: str, spec: dict, base: str = DEFAULT_TEMPLATE_ID,
                  display_name: str = "") -> str:
    """把样式固化为新模板（与工科/管科同级，只新增不改默认），返回 styles.yaml 路径。

    此后 build_docx / CLI 的 -t <new_id> 即可使用该模板。"""
    return str(style_core.save_template(new_id, spec, base=base,
                                        display_name=display_name or None))


@mcp.tool()
def remove_template(new_id: str) -> str:
    """删除派生模板（仅允许删 source=derived 的），恢复配置干净。"""
    if style_core.remove_template(new_id):
        return f"已删除派生模板: {new_id}"
    return f"模板不存在: {new_id}"


# ------------------------------------------------------------------ 学校模板接入

def _ensure_docx(p: str) -> Path:
    path = Path(p).expanduser().resolve()
    if not path.is_file():
        raise ValueError(f"docx 不存在: {path}")
    if path.suffix.lower() != ".docx":
        raise ValueError(f"只接受 .docx（.doc 是二进制格式，请先用 Word/WPS/LibreOffice 另存为 .docx）: {path}")
    return path


def _fmt_report(report: dict, body_from: int = 0, body_to: int | None = None) -> str:
    """把 analyze 的 outline 压成可读文本：字体/字号/行距/缩进/对齐逐段实测。

    封面与尾表由 detect 单独给（整页搬运，不必逐段看），这里只呈现正文区。
    """
    lines: list[str] = []
    sect = report.get("section") or {}
    pgsz, pgmar = sect.get("pgSz") or {}, sect.get("pgMar") or {}
    if pgsz:
        w, h = pgsz.get("w"), pgsz.get("h")
        if w and h:
            lines.append(f"页面: {int(w) / 567:.1f}cm x {int(h) / 567:.1f}cm")
    if pgmar:
        lines.append("边距(上/右/下/左 twips): " + " / ".join(
            str(pgmar.get(k)) for k in ("top", "right", "bottom", "left") if pgmar.get(k)))
    if (report.get("section") or {}).get("docGrid"):
        lines.append("docGrid: " + json.dumps(sect["docGrid"], ensure_ascii=False))
    dd = report.get("docDefaults") or {}
    if dd.get("fonts"):
        lines.append("docDefaults 字体: " + json.dumps(dd["fonts"], ensure_ascii=False)
                     + f"（样式数 {dd.get('styles_defined')}）")

    outline = report.get("outline") or []
    end = len(outline) if body_to is None else min(body_to, len(outline))
    rows = [r for r in outline[body_from:end] if r.get("kind") == "p"]
    lines.append(f"\n正文段落实测（共 {len(rows)} 段，逐条对应 spec 的 body/headings/title）:")
    for r in rows:
        bits = []
        run = r.get("run") or {}
        # 源文档常用「;」或',' 串多个字体名；中英文同源时只报一次
        cjk = str(run.get("cjk") or "").replace(";", "/")
        latin = str(run.get("latin") or "").replace(";", "/")
        if cjk and cjk == latin:
            bits.append(cjk)
        else:
            if cjk:
                bits.append(cjk)
            if latin:
                bits.append(latin)
        if run.get("sz"):
            bits.append(f"sz={run['sz']}→{int(run['sz']) // 2}pt")
        if run.get("bold"):
            bits.append("加粗")
        ppr = r.get("pPr") or {}
        if ppr.get("jc"):
            bits.append(f"对齐={ppr['jc']}")
        sp = ppr.get("spacing") or {}
        if sp.get("line"):
            rule = {"exact": "固定值", "atLeast": "最小值", "auto": "多倍"}.get(
                sp.get("lineRule", ""), sp.get("lineRule", ""))
            bits.append(f"行距={rule}{int(sp['line']) / 240:.2f}倍" if sp.get("lineRule") == "auto"
                        else f"行距={rule}{int(sp['line']) / 20}磅")
        if sp.get("before"):
            bits.append(f"段前={int(sp['before']) / 20}磅")
        if sp.get("after"):
            bits.append(f"段后={int(sp['after']) / 20}磅")
        ind = ppr.get("ind") or {}
        for k, label in (("firstLineChars", "首行缩进(字符)"), ("firstLine", "首行缩进(twips)"),
                         ("leftChars", "左缩进(字符)"), ("left", "左缩进(twips)")):
            if ind.get(k):
                bits.append(f"{label}={ind[k]}")
        if (r.get("marks") or []):
            bits.append("/".join(r["marks"]))
        text = (r.get("text") or "").strip()
        lines.append(f"  [{r['i']}] {text[:26]}" + (f"  → {' '.join(bits)}" if bits else ""))
    return "\n".join(lines) or "（未解析到内容）"


@mcp.tool()
def analyze_docx(docx_path: str, marker: str = "", with_text: bool = False) -> str:
    """只读解剖任意一份 docx，为「把它复刻成模板」提供事实依据。不写任何文件。

    docx_path 传学校官方模板/学生范例的绝对路径。
    marker 可选：正文起点标记文本（如 "摘要"），不给则自动探测。
    with_text=True 时附带 body 全文（摘字号/格式要求用，别省这一步）。

    返回：页面设置 twips、正文/标题逐段实测（字体/字号/行距/缩进/对齐）、
    封面与尾部评分表切片边界。之后用 clone_template 落地成模板。"""
    src = _ensure_docx(docx_path)
    report = _factory_analyze(src)
    det = detect_blocks(src, marker=marker or None)
    cover = det.get("cover") or {}
    tail = det.get("tail") or {}
    body_len = report.get("body_len", 0)
    # 封面/尾表都是 body 里的连续切片，其余段落即正文区（可能夹在封面之前，如格式规范说明）
    blocks = [b["slice"] for b in (cover, tail) if b.get("slice")]
    body_from = min((s[1] for s in blocks), default=0)
    body_to = max((s[0] for s in blocks), default=body_len)

    out = [f"源文件: {src}", ""]
    out.append("【封面 / 尾表：整页原样搬运，不复刻、不逐段分析】")
    for k, blk in (("封面", cover), ("尾部评审表", tail)):
        if not blk:
            out.append(f"  {k}: 未探测到（该文种可能没有）")
            continue
        sl = blk.get("slice")
        out.append(f"  {k}: body[{sl[0]}:{sl[1]}] 依据={blk.get('evidence') or blk.get('strategy')}"
                   + (f" 首文本={blk['first_text']!r}" if blk.get("first_text") else "")
                   + (f" 标题={blk['title']!r}" if blk.get("title") else ""))
    out.append(f"\n正文区 = body[{body_from}:{body_to}]"
               + ("（封面之前无内容）" if body_from == 0 else "（含封面之前的格式说明段）"))
    out.append("")
    out.append(_fmt_report(report, body_from=body_from, body_to=body_to))
    if with_text:
        out.append("\n--- body 全文（未截断，摘格式要求用）---")
        for p in dump_text(src):
            out.append(json.dumps(p, ensure_ascii=False))
    out.append("\n下一步：clone_template(docx_path=..., new_id=..., name=...)")
    return "\n".join(out)


@mcp.tool()
def clone_template(docx_path: str, new_id: str, name: str, marker: str = "",
                   numbering: str = "", force: bool = False) -> str:
    """把一份学校官方 docx 反向复刻成 wordEditor 可用模板（工厂全链路 + 机械验收）。

    这是接入新学校的唯一推荐路径，不要手写 reference.docx / styles.yaml。
    自动完成：建 templates/<new_id>/ 脚手架 → 按源实测预填 spec.yaml →
    构建三件套+封面/尾表块 → 生成样例 MD → 真实构建 → template_verify 0 FAIL 验收。

    docx_path  源 docx 绝对路径（.doc 请先另存为 .docx）
    new_id     模板 id，英文数字连字符，如 "csu-law-graduate"
    name       显示名，如 "中南大学 · 法学硕士论文"
    marker     正文起点标记文本（"摘要"/"绪论"），不给则自动探测
    numbering  "gongke"(1.1.1) 或 "guanke"(一、) ，不给按自动探测结果
    force      已存在同名目录时覆盖（会重写 spec.yaml，慎用）

    返回 spec 路径、TODO 清单、验收结论。ok=true 即模板可用，
    build_docx(template_id=new_id) 立刻能导出。"""
    src = _ensure_docx(docx_path)
    if not re.fullmatch(r"[\w-]+", new_id):
        return f"失败：非法模板 id {new_id!r}（只允许英文/数字/下划线/连字符）"
    info = init_template(src, new_id, name, marker=marker or None, force=force)

    spec_path = Path(info["spec"])
    # 封面字段/评分表行是机械可读的（源表格逐格读出），不该留 TODO 让人手抄
    autofilled = _autofill_fields(spec_path)
    todo = _spec_todo(spec_path, autofilled.get("filled_rows", ()))
    if todo["unresolved"]:
        # 有 TODO 未由实测覆盖：先build 出来，但不冒充验收通过
        build(spec_path, do_register=True)
        return json.dumps({
            "id": new_id, "spec": str(spec_path), "dir": info["dir"],
            "registered": True, "ok": False, "autofilled": autofilled,
            "advisory": todo["advisory"],
            "reason": "spec 仍有未由实测覆盖的项，需人工/Agent 按 analyze_docx(with_text=True) 报告补齐后重跑验收",
            "unresolved": todo["unresolved"],
            "next": info["next"],
        }, ensure_ascii=False, indent=2)

    res = run_pipeline(spec_path)
    return json.dumps({
        "id": new_id, "spec": str(spec_path), "dir": info["dir"],
        "registered": res.get("registered", True),
        "autofilled": autofilled,
        "sample_md": res.get("sample_md"), "sample_docx": res.get("output"),
        "ok": res.get("ok", False),
        "advisory": todo["advisory"],
        "verify_tail": res.get("verify_tail"),
        "usage": f"build_docx(md_path=..., template_id='{new_id}')  或  we build <md> -t {new_id}",
    }, ensure_ascii=False, indent=2)


def _autofill_fields(spec_path: Path) -> dict:
    """把源 docx 表格逐格读出的封面字段/评分表行写回 spec.yaml（幂等）。

    机械可读的部分交给机器；只留真正需要人判断的（评分项groups）。

    注意：spec.yaml 里有铁律注释（如 hutb-shehui-diaocha 顶部那几条），
    所以这里做**文本级定点替换**，不走 yaml.safe_dump 往返 —— 往返会洗掉全部注释。
    """
    import yaml
    from tpl_factory.workflow import extract_fields

    try:
        got = extract_fields(spec_path)
    except SystemExit:
        return {"applied": [], "filled_rows": (), "skipped": "切片探测失败"}

    text = spec_path.read_text(encoding="utf-8")
    spec = yaml.safe_load(text) or {}
    applied: list[str] = []

    def set_scalar(key: str, value: str, indent: int, parent: str = "") -> bool:
        """把**单行**的 `key: <值>` 换成 `key: "新值"`，只动这一行。

        两个必须：
        - 限制成单行：spec 顶层有 `title:` 后缩进再给子键的跨行映射（title 段），
          `(\\S.*)$` 会跨到下一行把缩进吃掉，写出结构损坏的 YAML；
        - 必须指定缩进：`title` 在缩进 0（正文题目段，多行映射）与缩进 2
          （tail 段，单行标量）各出现一次，不给缩进会改错地方。

        parent 是校验用的父键路径（tail.rubric 的 k传 "tail.rubric"）。
        **校验必须走完整层级** —— 只按 key 顶层查会误判成"没写进去"而永远返回 False。
        """
        nonlocal text
        val = json.dumps(value, ensure_ascii=False)
        pat = re.compile(rf'^({" " * indent}){re.escape(key)}:\s*(\S.*)$', re.M)
        if not pat.search(text):
            return False
        new = pat.sub(lambda m: f"{m.group(1)}{key}: {val}", text, count=1)
        # 守卫：结构必须仍可解析，且该层级确实取到了新值
        try:
            probe = yaml.safe_load(new) or {}
        except yaml.YAMLError:
            return False
        node = probe
        for part in [p for p in parent.split(".") if p] + [key]:
            if not isinstance(node, dict) or part not in node:
                return False
            node = node[part]
        if node != value:
            return False
        text = new
        return True

    cover = spec.get("cover")
    fields_yaml = got.get("cover_fields_yaml") or []
    if isinstance(cover, dict) and fields_yaml and not cover.get("fields"):
        # `  fields: []   # TODO…` → `  fields:\n<各行>`
        # 行尾那条 TODO 说明要挪到块上方当注释，别让它跟着 `[]` 一起消失
        # （人写的说明比机器填的值更重要）。
        pat = re.compile(r'^(\s*)fields:\s*\[\]\s*(#.*)$', re.M)
        m = pat.search(text)
        if m:
            head, note = m.group(1), m.group(2).strip()
            block = f"{head}fields:\n" + "\n".join(fields_yaml) + f"\n{head}{note}\n"
            cand = text[:m.start()] + block + text[m.end():]
            try:
                probe = yaml.safe_load(cand) or {}
            except yaml.YAMLError:
                probe = None
            if isinstance((probe or {}).get("cover"), dict) and (probe["cover"].get("fields") or []):
                text = cand
                applied.append(f"cover.fields × {len(fields_yaml)}")

    tail = spec.get("tail")
    rub = got.get("rubric_yaml") or {}
    if isinstance(tail, dict):
        if (not tail.get("title") or "TODO" in str(tail.get("title"))):
            src_docx = spec_path.parent / (spec.get("source_docx") or "source.docx")
            if src_docx.is_file():
                det_title = (detect_blocks(src_docx).get("tail") or {}).get("title")
                #缩进 2 = tail 段下的 title（缩进 0 那处是正文题目段，不能碰）
                if det_title and set_scalar("title", det_title, indent=2, parent="tail"):
                    applied.append("tail.title")
        for k in ("grade_row", "remark_row", "signature_row"):
            if rub.get(k) and ("TODO" in str((tail.get("rubric") or {}).get(k) or "")):
                if set_scalar(k, rub[k], indent=4, parent="tail.rubric"):
                    applied.append(f"tail.rubric.{k}")
        # 不填 other_rows：spec 模板与人工填写的样板里都没有这个键（不是必需字段），
        # 源表里那些"姓名/学号/题目"行本来就随尾表整页搬运，不参与docx 渲染。

    spec_path.write_text(text, encoding="utf-8")
    # 校验：改完必须仍能解析，且确实写进去了（写不进去就报，不留半成品）
    after = yaml.safe_load(spec_path.read_text(encoding="utf-8")) or {}
    if not applied:
        return {"applied": [], "filled_rows": (), "skipped": "spec 结构不匹配，未改动"}
    if not (after.get("cover") or {}).get("fields") and "cover.fields" in applied:
        applied.remove("cover.fields")
        applied.append("cover.fields 未写入（结构不匹配）")
    return {"applied": applied,
            "filled_rows": tuple(k for k in ("grade_row", "remark_row", "signature_row")
                                 if rub.get(k))}


def _spec_todo(spec_path: Path, filled_rows: tuple = ()) -> dict:
    """列出 spec.yaml 里还是占位/未由实测覆盖的项（空值 + 残留 TODO 字符串）。

    filled_rows: extract_fields 实际在源表里读到的行名。源表本来就有的行才纳入检查，
    源里没有的行（如无成绩行的评审表）不算缺失。"""
    import yaml
    spec = yaml.safe_load(spec_path.read_text(encoding="utf-8")) or {}
    unresolved: list[str] = []
    advisory: list[str] = []

    def probe(path: str, got) -> None:
        if got in (None, "", [], {}):
            unresolved.append(path)
        elif isinstance(got, str) and "TODO" in got:
            unresolved.append(f"{path} 仍是占位文本")

    for i, h in enumerate(spec.get("headings") or [], start=1):
        if ((h.get("run") or {}).get("size_half_pt")) is None:
            unresolved.append(f"headings[{i}].run.size_half_pt")
    for key in ("body", "title", "abstract"):
        sec = spec.get(key) or {}
        if sec and (sec.get("run") or {}).get("size_half_pt") is None:
            unresolved.append(f"{key}.run.size_half_pt")
    cover = spec.get("cover") if isinstance(spec.get("cover"), dict) else None
    tail = spec.get("tail") if isinstance(spec.get("tail"), dict) else None
    probe("cover.fields", (cover or {}).get("fields"))
    if tail is not None:
        probe("tail.title", tail.get("title"))
        rub = tail.get("rubric") or {}
        for k in ("grade_row", "remark_row", "signature_row"):
            # 源表里本来就没有的行（extract_fields 返回 null）不算缺失，不阻塞出稿
            if k not in filled_rows:
                continue
            probe(f"tail.rubric.{k}", rub.get(k))
        # groups 只驱动 Web 表单的评分项渲染，不进 docx 产物 —— 缺了不阻塞出稿
        if not rub.get("groups"):
            advisory.append("tail.rubric.groups 为空：只有 Web 评分表表单会是空的，"
                            "不影响 docx 产物（评分表整页从源切片搬运）")
    return {"unresolved": unresolved, "advisory": advisory}


if __name__ == "__main__":
    mcp.run(transport="stdio")
