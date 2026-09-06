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

spec 由 Agent 从自然语言翻译（映射见 hutb-docx-export 技能 SKILL.md），例:
  {"title":{"font":"宋体","size":"小二","align":"center"}}

配置（~/.workbuddy/mcp.json，仅此一个条目）:
  "wordeditor": {
    "command": "<python>",
    "args": ["<wordEditor>/services/api-python/mcp_server.py"]
  }
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mcp.server.fastmcp import FastMCP

from direct import build_to_workspace, list_templates
import style_core

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
def build_docx(md_path: str, template_id: str = "hutb-guanke", output_path: str = "") -> str:
    """把 Markdown 按模板导出为 docx。

    md_path 可传 md 文件或工作区目录（目录时自动选取同名/唯一 md）。
    工作区 = md 所在目录；其下 images/、media/、charts/ 会随 md 一起打包。
    output_path 缺省时产物保存为 <工作区>/<md同名>.docx。
    返回产物绝对路径。"""
    out = build_to_workspace(
        md_path,
        template_id=template_id or "hutb-guanke",
        output_path=output_path or None,
    )
    return str(out)


@mcp.tool()
def apply_style(workspace: str, spec: dict, template_id: str = "hutb-guanke",
                output_path: str = "") -> str:
    """按自定义样式导出 docx（单次生效，不落持久状态、不改默认模板）。

    workspace=含主MD与images的文件夹；spec 见服务器 instructions 的映射；
    output_path 缺省时产物为 <工作区>/<MD同名>.docx。返回产物绝对路径。"""
    out = style_core.export_with_style(
        workspace, spec, template_id=template_id, output_path=output_path or None)
    return str(out)


@mcp.tool()
def save_style(name: str, spec: dict, template_id: str = "hutb-guanke") -> str:
    """把样式 spec 保存为命名临时样式（config/custom_styles/<name>.yaml），供复用。"""
    return str(style_core.save_style(name, spec, template_id))


@mcp.tool()
def list_styles() -> str:
    """列出已保存的命名临时样式及其 spec。"""
    items = style_core.list_styles()
    if not items:
        return "（无已保存的临时样式）"
    import json
    return "\n".join(f"- {i['name']} (基模板 {i['template']}): "
                     f"{json.dumps(i['spec'], ensure_ascii=False)}" for i in items)


@mcp.tool()
def save_template(new_id: str, spec: dict, base: str = "hutb-guanke",
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


if __name__ == "__main__":
    mcp.run(transport="stdio")
