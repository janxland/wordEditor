"""Web 结构化资产（fields.json / rubric.json）与 templates.json 注册。"""
import json
from pathlib import Path
import sys

_ROOT = Path(__file__).resolve().parents[3]  # tpl_factory/assets.py → 仓库根
CONFIG = _ROOT / "config" / "templates.json"

CONFIG = _ROOT / "config" / "templates.json"

def write_web_assets(spec: dict, out_dir: Path) -> list[Path]:
    out = []
    fields = spec["cover"].get("fields") or []
    if fields:
        p = out_dir / "fields.json"
        p.write_text(json.dumps({
            "template_id": spec["id"],
            "surface": "cover",
            "fields": [
                {"key": f["key"], "label": f["label"],
                 "default": f.get("default", ""),
                 "at": {k: v for k, v in f.items() if k in ("para", "row", "col")}}
                for f in fields
            ],
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        out.append(p)

    rubric = spec["tail"].get("rubric")
    if rubric:
        groups = []
        for g in rubric.get("groups", []):
            groups.append({
                "key": g["key"], "label": g["label"], "max": g.get("max"),
                "items": [{"desc": it["desc"], "score": it.get("score")} for it in g.get("items", [])],
            })
        p = out_dir / "rubric.json"
        p.write_text(json.dumps({
            "template_id": spec["id"],
            "surface": "tail",
            "title": spec["tail"].get("title", ""),
            "total": rubric.get("total"),
            "grade_row": rubric.get("grade_row"),
            "remark_row": rubric.get("remark_row"),
            "signature_row": rubric.get("signature_row"),
            "groups": groups,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        out.append(p)
    return out

def register(spec: dict, config_path: Path = CONFIG) -> bool:
    cfg = json.loads(config_path.read_text(encoding="utf-8"))
    tpl_dir = Path(f"templates/{spec['id']}")
    if any(t["id"] == spec["id"] for t in cfg["templates"]):
        print(f"· 已存在模板 {spec['id']}，跳过注册（如需覆盖请手动改 config/templates.json）",
              file=sys.stderr)
        return False
    entry = {
        "id": spec["id"],
        "name": spec["name"],
        "standalone": spec.get("standalone", True),
        "heading_numbering": spec.get("numbering", "guanke"),
        "reference_doc": str(tpl_dir / "reference.docx"),
        "lua_filter": spec.get("lua_filter", "templates/hutb-shared/markdown-to-docx.lua"),
        "extra_lua_filters": spec.get("extra_lua_filters",
                                      ["templates/hutb-shared/zhengwen-style.lua"]),
        "styles_yaml": str(tpl_dir / "styles.yaml"),
        "three_line_tables": spec.get("three_line_tables", True),
        "source": "derived",
        "cover_block": str(tpl_dir / "cover_block.xml"),
        "tail_block": str(tpl_dir / "tail_block.xml"),
        "note": spec.get("note", ""),
    }
    cfg["templates"].append(entry)
    config_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return True

