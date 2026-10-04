"""reference.docx 里标题多级编号的 numId 常量。

原为「标题编号注入」实现（定位 abstractNum + 改 lvlText/numFmt + 补 isLgl），
现已被 `ooxml_multilevel.apply_multilevel` 取代 —— 后者按 spec 的 multilevel_list
渲染，能按克隆文档的 styleId 重映射 heading 1..N，工厂路径统一走它。
本文件只剩这个被 ooxml_util / postprocess_document import 的常量。

改动前先读 templates/hutb-shehui-diaocha/spec.yaml 顶部铁律：
numId 2 / abstractNum 7 是学校 reference.docx 的实际值，勿改。
"""

from __future__ import annotations

import sys
from pathlib import Path
from xml.etree import ElementTree as ET

# 学校 reference.docx 内标题多级列表（勿改 numId，与 styles 中 heading 2–5 一致）
HUTB_HEADING_NUM_ID = 2

# 命名空间常量唯一定义在 api-python 根的 ooxml_ns.py（本文件在 pipeline/ 下）。
_API_DIR = str(Path(__file__).resolve().parents[1])
if _API_DIR not in sys.path:
    sys.path.insert(0, _API_DIR)

from ooxml_ns import NS  # noqa: E402

_Q = "{%s}" % NS["w"]


def max_abstract_id(root: ET.Element) -> int:
    """numbering.xml 里已用的最大 abstractNumId；空文档返回 -1。

    是 ooxml_multilevel（标题多级编号）与 ooxml_list_styles（列表样式库）
    分配新 abstractNum 的共同起点 —— 只有这一份实现。
    """
    m = -1
    for ab in root.findall("w:abstractNum", NS):
        try:
            m = max(m, int(ab.get(_Q + "abstractNumId", "0")))
        except ValueError:
            pass
    return m
