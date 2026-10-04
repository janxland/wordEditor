#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""OOXML 命名空间常量 —— 全仓唯一定义（第 03 轮 D14）。

为什么单独抽一层：
    这些 URI 字符串**与 XML 栈无关** —— ElementTree、lxml、python-docx 用的是同一批
    URI。但第 02 轮之前它们在 clone_core / tpl_factory.ooxml / template_verify /
    ooxml_util / ooxml_schema_order / ooxml_numbering / pipeline.tools.* 各写了一份
    （7+ 处）。改 URI 时漏改一处，症状是 `find()` 静默返回 None = 「格式没生效」，
    而不是报错 —— 极难定位。

**不放在这里的东西**：`q()` / `_q()` / `Q()` 这类构造器。它们返回 `{uri}tag` 字符串，
看似与栈无关，但第 02 轮已判定：`_set_wordwrap_zero` 的两份实现分别吃 ET.Element 与
lxml 元素，元素类型不通用。构造器跟着各自的栈留在原模块，不合并。

改动前必读：W 的 URI 写错 → 全仓 find 全灭。改这里等于改全仓。
"""

# WordprocessingML 主命名空间（w: 前缀）
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
# Office 关系（r: 前缀，rId / embed / link 等属性）
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
# XML 标准属性命名空间（xml:space="preserve"）
XML = "http://www.w3.org/XML/1998/namespace"

# find / findall / xpath 用的前缀映射。
# ⚠️ 取值冲突（第 03 轮）：合并前存在两种值 —— ooxml_util 系是 {"w": W}，
# clone_core 系是 {"w": W, "r": R}。取**超集** {"w": W, "r": R}：
# ET 与 lxml 都只解析路径里实际出现的前缀，多给前缀不改变任何一次查找的结果
# （全仓 NS 的用法已逐处核对，100% 是 find/findall/xpath，无一处用于序列化）。
NS = {"w": W, "r": R}
