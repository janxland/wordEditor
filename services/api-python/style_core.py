#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
hutb-docx-export 样式层 —— 自然语言样式覆盖核心（不碰默认配置）。

三种用法:
  1. 临时单次:  export_with_style(workspace, spec)      → docx，不落任何持久状态
  2. 保存临时:  save_style(name, spec)                  → custom_styles/<name>.yaml，可反复加载
  3. 保存新模板: save_template(new_id, spec)            → 与工科/管科同级的新模板，全部通道可用

spec（由 Agent 从自然语言翻译，YAML/JSON dict）:
  title:   {font: 宋体, size: 小二, align: center, bold: true}   # 文章标题(Title)
  h1..h4:  同上 + numbering: {fmt: "一、", font: 黑体, size: 四号, bold: true}
  body:    {font: 宋体, size: 小四, align: both, line_spacing: 1.5, indent: 2}
  abstract / keywords / abstract_en / keywords_en: 同上
  styles:  [ {name: "Abstract Title", font: ..., size: ...} ]    # 按样式名自由匹配

中文值映射:
  字号: 初号42 小初36 一号26 小一24 二号22 小二18 三号16 小三15 四号14 小四12 五号10.5 小五9 (pt→半磅×2)
  对齐: 左对齐left 居中center 右对齐right 两端对齐both
  行距: 单倍single / 1.5 / 双倍double / 固定值"22pt"
"""
from __future__ import annotations

import json
import re
import sys
import tempfile
from pathlib import Path

import os

WORDEDITOR_ROOT = Path(os.environ.get(
    "WORDEDITOR_ROOT", "/Users/Admin1/Desktop/project/janxland/wordEditor"))
API_DIR = WORDEDITOR_ROOT / "services" / "api-python"
PIPE_DIR = API_DIR / "pipeline"
for p in (str(API_DIR), str(PIPE_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

import direct  # noqa: E402  (工作区构建核心)
from postprocess_pipeline import run_styles_postprocess  # noqa: E402
import yaml  # noqa: E402

CUSTOM_DIR = WORDEDITOR_ROOT / "config" / "custom_styles"

SIZE_PT = {"初号": 42, "小初": 36, "一号": 26, "小一": 24, "二号": 22, "小二": 18,
           "三号": 16, "小三": 15, "四号": 14, "小四": 12, "五号": 10.5, "小五": 9}
ALIGN = {"左对齐": "left", "居中": "center", "右对齐": "right",
         "两端对齐": "both", "分散对齐": "distribute", "两端": "both"}
LS_MAP = {"单倍": "single", "单倍行距": "single", "1.5倍": 1.5, "1.5": 1.5,
          "双倍": "double", "两倍": "double"}
CJK_FONTS = {"宋体", "黑体", "楷体", "楷体_GB2312", "仿宋", "仿宋_GB2312", "微软雅黑", "隶书"}

TARGET_MATCH = {           # 目标 → postprocess_styles 的 match
    "title":  {"name": "Title"},
    "h1":     {"name_regex": r"^heading 1$"},
    "h2":     {"name_regex": r"^heading 2$"},
    "h3":     {"name_regex": r"^heading 3$"},
    "h4":     {"name_regex": r"^heading 4$"},
    "body":   {"kind": "body"},
    "abstract":   {"name": "摘要"},
    "abstract_en": {"name": "Abstract"},
    "keywords":   {"name": "关键词"},
    "keywords_en": {"name": "Keywords"},
}
SPEC_KEYS = list(TARGET_MATCH) + ["styles"]
NUM_FMT_ALIAS = {"一、": ("chineseCounting", "%1、"), "（一）": ("chineseCounting", "（%2）"),
                 "1.": ("decimal", "%1."), "1.1": ("decimal", "%1.%2"),
                 "1.1.1": ("decimal", "%1.%2.%3"), "⒈": ("decimalEnclosedCircle", "%3.")}


def norm_size(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(v * 2)  # 直接给 pt
    v = str(v).strip()
    if v in SIZE_PT:
        return int(SIZE_PT[v] * 2)
    m = re.fullmatch(r"([\d.]+)\s*(pt|磅)?", v)
    return int(float(m.group(1)) * 2) if m else None


def norm_ls(v):
    if v is None:
        return None
    if v in LS_MAP:
        return LS_MAP[v]
    return v


def build_override(target: str, props: dict) -> dict:
    """把一个目标的自然语言属性翻译成 DSL override 条目。"""
    ov: dict = {"match": dict(TARGET_MATCH[target])}
    para: dict = {}
    run: dict = {}
    font = props.get("font")
    if font:
        run["cjk_font"] = font
        run["latin_font"] = "Times New Roman" if font in CJK_FONTS else font
    size = norm_size(props.get("size"))
    if size:
        run["size_half_pt"] = size
        run["size_cs_half_pt"] = size
    if "bold" in props:
        run["bold"] = bool(props["bold"])
    align = props.get("align")
    if align:
        para["align"] = ALIGN.get(align, align)
    ls = norm_ls(props.get("line_spacing") or props.get("行距"))
    if ls:
        para["line_spacing"] = ls
    if "indent" in props:
        para["first_line_chars"] = int(props["indent"])
    if "spacing_before" in props:
        para["spacing_before_dxa"] = int(float(props["spacing_before"]) * 20)
    if "spacing_after" in props:
        para["spacing_after_dxa"] = int(float(props["spacing_after"]) * 20)
    if props.get("no_indent"):
        para["indent_clear"] = True
    if para:
        ov["paragraph"] = para
    if run:
        ov["run"] = run
    return ov


def _did_you_mean(value, candidates: list) -> str:
    import difflib
    m = difflib.get_close_matches(str(value), candidates, n=1, cutoff=0.4)
    return f"（你是想用 \"{m[0]}\" 吗？）" if m else f"（合法值: {', '.join(candidates)}）"


# spec 属性键白名单（NL2DSL 实践：受限语法 + 白名单，fail fast）
PROP_KEYS = {"font", "size", "align", "bold", "line_spacing", "indent",
             "spacing_before", "spacing_after", "no_indent", "numbering"}


def validate_spec(spec: dict) -> dict:
    """确定性校验 + QuickFix 建议（自修复循环第 1 级）。

    返回 {ok, errors, warnings}；errors 非空时调用方应终止并回显给 Agent 修复。"""
    errors, warnings = [], []
    if not isinstance(spec, dict) or not spec:
        return {"ok": False, "errors": ["spec 必须是非空 JSON 对象"], "warnings": []}
    for key, props in spec.items():
        if key == "styles":
            if not isinstance(props, list):
                errors.append("styles 必须是数组，每项含 name")
                continue
            for i, item in enumerate(props):
                if not isinstance(item, dict) or "name" not in item:
                    errors.append(f"styles[{i}] 缺少 name 字段")
            continue
        if key not in TARGET_MATCH:
            errors.append(f"未知样式目标 \"{key}\" {_did_you_mean(key, SPEC_KEYS)}")
            continue
        if not isinstance(props, dict):
            errors.append(f"{key} 的值必须是对象，收到 {type(props).__name__}")
            continue
        for pk, pv in props.items():
            if pk not in PROP_KEYS:
                errors.append(f"{key}.{pk} 不是合法属性 {_did_you_mean(pk, sorted(PROP_KEYS))}")
                continue
            if pk == "font" and str(pv) not in CJK_FONTS and str(pv) != "Times New Roman":
                warnings.append(f"{key}.font=\"{pv}\" 不是常见中文字体/Times New Roman，请确认系统已安装")
            elif pk == "size" and norm_size(pv) is None:
                errors.append(f"{key}.size=\"{pv}\" 无法解析 {_did_you_mean(pv, list(SIZE_PT) + ['18pt'])}")
            elif pk == "align" and ALIGN.get(pv, pv) not in ("left", "center", "right", "both", "distribute"):
                errors.append(f"{key}.align=\"{pv}\" 非法 {_did_you_mean(pv, list(ALIGN) + ['left','center','right','both'])}")
            elif pk == "numbering" and key not in ("h1", "h2", "h3", "h4"):
                errors.append(f"{key} 不支持 numbering（仅 h1–h4 是多级列表级别）")
            elif pk == "numbering" and isinstance(pv, dict):
                bad = set(pv) - {"fmt", "font", "size", "align", "bold"}
                if bad:
                    errors.append(f"{key}.numbering 有未知字段: {', '.join(sorted(bad))}")
    return {"ok": not errors, "errors": errors, "warnings": warnings}


def apply_spec(base_dsl: dict, spec: dict) -> dict:
    """在基础 styles DSL 上叠加 spec，返回新 dict（不改 base）。"""
    import copy
    dsl = copy.deepcopy(base_dsl)
    dsl.pop("extends", None)
    ov_list = dsl.setdefault("overrides", [])

    for key, props in spec.items():
        if key == "styles":
            for item in props:
                ov_list.append(build_override_style(item))
            continue
        if key not in TARGET_MATCH:
            raise ValueError(f"未知样式目标: {key}（可用: {', '.join(SPEC_KEYS)}）")
        props = dict(props)
        numbering = props.pop("numbering", None)
        ov_list.append(build_override(key, props))
        if numbering and key in ("h1", "h2", "h3", "h4"):
            lvls = dsl.get("multilevel_list", {}).get("levels")
            if not lvls:
                print(f"⚠ 基础模板无 multilevel_list，忽略 {key}.numbering", flush=True)
                continue
            lvl = lvls[int(key[1]) - 1]
            nrun, npara = lvl.setdefault("run", {}), lvl.setdefault("paragraph", {})
            fmt = numbering.get("fmt")
            if fmt:
                nf, lt = NUM_FMT_ALIAS.get(fmt, (None, fmt))
                if nf:
                    lvl["num_fmt"] = nf
                lvl["lvl_text"] = lt
            if "font" in numbering:
                nrun["cjk_font"] = numbering["font"]
            nsize = norm_size(numbering.get("size"))
            if nsize:
                nrun["size_half_pt"] = nsize
                nrun["size_cs_half_pt"] = nsize
            if "bold" in numbering:
                nrun["bold"] = bool(numbering["bold"])
            nalign = numbering.get("align")
            if nalign:
                npara["align"] = ALIGN.get(nalign, nalign)
    return dsl


def build_override_style(item: dict) -> dict:
    """自由样式名匹配条目。name 必填。"""
    item = dict(item)
    name = item.pop("name")
    ov = build_override("title", item)  # 借用翻译逻辑（match 会被替换）
    ov["match"] = {"name": name}
    return ov


def load_base(template_id: str) -> dict:
    tpl = next((t for t in direct.list_templates() if t["id"] == template_id), None)
    cfg = json.loads((WORDEDITOR_ROOT / "config" / "templates.json").read_text("utf-8"))
    entry = next((t for t in cfg["templates"] if t["id"] == template_id), None)
    if not entry or not entry.get("styles_yaml"):
        raise ValueError(f"模板 {template_id} 无 styles_yaml")
    sys.path.insert(0, str(PIPE_DIR))
    from postprocess_styles import load_dsl
    return load_dsl(WORDEDITOR_ROOT / entry["styles_yaml"])


def resolve_spec(spec: str | dict) -> dict:
    """spec 可以是 dict / 内联 JSON 字符串 / custom_styles 里的名字 / yaml 文件路径。"""
    if isinstance(spec, dict):
        return spec
    s = str(spec).strip()
    if s.startswith("{"):
        return json.loads(s)
    p = Path(s)
    name_yaml = CUSTOM_DIR / f"{s}.yaml" if not p.is_file() else p
    if not name_yaml.is_file():
        name_yaml = CUSTOM_DIR / f"{s}.json"
    if not name_yaml.is_file():
        raise ValueError(f"找不到样式: {s}（custom_styles/ 下无同名文件）")
    text = name_yaml.read_text("utf-8")
    data = yaml.safe_load(text) if name_yaml.suffix == ".yaml" else json.loads(text)
    return data.get("spec", data) if isinstance(data, dict) else data


def _checked(spec) -> dict:
    """解析 + 校验。校验失败时回显确定性修复建议（Agent 据此自修正）。"""
    s = resolve_spec(spec)
    v = validate_spec(s)
    for w in v["warnings"]:
        print(f"⚠ {w}", flush=True)
    if not v["ok"]:
        raise ValueError("spec 校验失败:\n" + "\n".join(f"  - {e}" for e in v["errors"]))
    return s


def export_with_style(workspace, spec, template_id="hutb-guanke",
                      output_path=None, md=None) -> Path:
    """临时单次：按基础模板构建 → 进程内叠加自定义 styles DSL → docx。"""
    from postprocess_styles import load_dsl
    spec_dict = _checked(spec)
    print(f"[spec] {json.dumps(spec_dict, ensure_ascii=False)}", flush=True)  # 全链路可回放
    merged = apply_spec(load_base(template_id), spec_dict)
    md_path = direct.resolve_md(md or workspace)
    out = Path(output_path).expanduser().resolve() if output_path \
        else md_path.parent / f"{md_path.stem}.docx"
    direct.build_to_workspace(md_path, template_id=template_id, output_path=str(out))
    tmp = tempfile.NamedTemporaryFile(suffix=".yaml", delete=False)
    tmp.write(yaml.safe_dump(merged, allow_unicode=True, sort_keys=False).encode("utf-8"))
    tmp.close()
    try:
        rc = run_styles_postprocess(out, Path(tmp.name))
        if rc != 0:
            raise RuntimeError(f"样式注入失败 (exit {rc})")
    finally:
        Path(tmp.name).unlink(missing_ok=True)
    return out


def save_style(name: str, spec, template_id="hutb-guanke") -> Path:
    """保存临时样式（named preset），返回 yaml 路径。"""
    CUSTOM_DIR.mkdir(parents=True, exist_ok=True)
    path = CUSTOM_DIR / f"{re.sub(r'[\\/:*?\"<>| ]+', '_', name)}.yaml"
    path.write_text(yaml.safe_dump(
        {"template": template_id, "spec": _checked(spec)},
        allow_unicode=True, sort_keys=False), encoding="utf-8")
    return path


def list_styles() -> list[dict]:
    if not CUSTOM_DIR.is_dir():
        return []
    out = []
    for p in sorted(CUSTOM_DIR.glob("*.yaml")):
        d = yaml.safe_load(p.read_text("utf-8")) or {}
        out.append({"name": p.stem, "template": d.get("template"), "spec": d.get("spec")})
    return out


def save_template(new_id: str, spec, base="hutb-guanke",
                  display_name: str | None = None) -> Path:
    """把样式固化为与工科/管科同级的新模板（只新增，不改默认）。"""
    if not re.fullmatch(r"[\w-]+", new_id):
        raise ValueError(f"非法模板 id: {new_id}")
    cfg_path = WORDEDITOR_ROOT / "config" / "templates.json"
    cfg = json.loads(cfg_path.read_text("utf-8"))
    existing = next((t for t in cfg["templates"] if t["id"] == new_id), None)
    if existing and existing.get("source") != "derived":
        raise ValueError(f"模板已存在且非派生模板，拒绝覆盖: {new_id}")
    base_entry = next(t for t in cfg["templates"] if t["id"] == base)

    from postprocess_styles import load_dsl
    merged = apply_spec(load_dsl(WORDEDITOR_ROOT / base_entry["styles_yaml"]),
                        _checked(spec))
    merged["template"] = {"id": new_id, "name": display_name or new_id}
    tdir = WORDEDITOR_ROOT / "templates" / new_id
    tdir.mkdir(parents=True, exist_ok=True)
    yaml_path = tdir / "styles.yaml"
    yaml_path.write_text(yaml.safe_dump(merged, allow_unicode=True, sort_keys=False),
                         encoding="utf-8")

    new_entry = {
        "id": new_id, "name": display_name or new_id, "standalone": True,
        "heading_numbering": base_entry.get("heading_numbering", "guanke"),
        "reference_doc": base_entry.get("reference_doc"),
        "lua_filter": base_entry.get("lua_filter"),
        "extra_lua_filters": base_entry.get("extra_lua_filters", []),
        "styles_yaml": f"templates/{new_id}/styles.yaml",
        "three_line_tables": True, "source": "derived",
        "note": f"由 {base} + 自然语言样式派生",
    }
    if existing:
        existing.update(new_entry)
    else:
        cfg["templates"].append(new_entry)
    cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", "utf-8")
    return yaml_path


def remove_template(new_id: str) -> bool:
    """删除派生模板（仅允许删 source=derived 的），恢复配置干净。"""
    cfg_path = WORDEDITOR_ROOT / "config" / "templates.json"
    cfg = json.loads(cfg_path.read_text("utf-8"))
    entry = next((t for t in cfg["templates"] if t["id"] == new_id), None)
    if not entry:
        return False
    if entry.get("source") != "derived":
        raise ValueError("只允许删除派生模板")
    cfg["templates"] = [t for t in cfg["templates"] if t["id"] != new_id]
    cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", "utf-8")
    import shutil
    shutil.rmtree(WORDEDITOR_ROOT / "templates" / new_id, ignore_errors=True)
    return True
