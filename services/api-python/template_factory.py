#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""模板工厂 CLI：spec.yaml → wordEditor 可注册的完整模板（三件套 + 块 + web 资产）。

实现按职责拆在 tpl_factory/ 包里（本文件只是命令行入口 + 兼容再导出）：
    tpl_factory/ooxml.py       最底层 OOXML 读写原语
    tpl_factory/detect.py      封面 / 评分表块边界自动探测
    tpl_factory/slices.py      字节级切片（原样打包封面 / 评分表）
    tpl_factory/reference.py   reference.docx 生成与整包克隆
    tpl_factory/styles_yaml.py styles.yaml DSL 渲染
    tpl_factory/assets.py      web 资产（fields/rubric.json）+ 注册
    tpl_factory/spec.py        spec 读写 + 骨架模板
    tpl_factory/workflow.py    子命令编排（build/check/analyze/text/fields/run/init）

用法
----
    python template_factory.py build   templates/<id>/spec.yaml [--no-register]
    python template_factory.py check   templates/<id>/spec.yaml
    python template_factory.py init    <源docx> <id> --name "..." [--marker 摘要] [--force]
    python template_factory.py text    <源docx>
    python template_factory.py analyze <源docx>
    python template_factory.py detect  <源docx> [--marker 摘要]
    python template_factory.py fields  templates/<id>/spec.yaml
    python template_factory.py run     templates/<id>/spec.yaml [--md <测试.md>]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tpl_factory.detect import detect_blocks            # noqa: E402
from tpl_factory.ooxml import _RID_ATTR_B, iter_body_top_level  # noqa: E402
from tpl_factory.spec import load_spec                  # noqa: E402
from tpl_factory.workflow import (                      # noqa: E402
    analyze, build, check, dump_text, extract_fields, init_template, run_pipeline,
)

__all__ = ["load_spec", "iter_body_top_level", "_RID_ATTR_B", "detect_blocks",
           "analyze", "build", "check", "dump_text", "extract_fields",
           "init_template", "run_pipeline"]


def main() -> None:
    ap = argparse.ArgumentParser(description="wordEditor 模板工厂")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p1 = sub.add_parser("build", help="按 spec 生成模板三件套并注册")
    p1.add_argument("spec")
    p1.add_argument("--no-register", action="store_true")
    p2 = sub.add_parser("check", help="只校验 spec 的切片边界（auto 时展示探测结果）")
    p2.add_argument("spec")
    p3 = sub.add_parser("analyze", help="解剖源 docx，输出填 spec 所需的事实")
    p3.add_argument("docx")
    p4 = sub.add_parser("detect", help="自动探测封面 / 尾页评分表的切片边界（不写产物）")
    p4.add_argument("docx")
    p4.add_argument("--marker", default=None, help="正文起点标记文本，如 摘要")
    p5 = sub.add_parser("text", help="全量输出 body 逐段完整文本（不截断），摘格式要求专用")
    p5.add_argument("docx")
    p6 = sub.add_parser("init", help="脚手架：建模板目录 + 拷源 + 预填 spec + 跑 detect")
    p6.add_argument("docx")
    p6.add_argument("id")
    p6.add_argument("--name", required=True, help="模板显示名，如 '湖南工商大学 · XX课程 · 课程论文'")
    p6.add_argument("--marker", default=None, help="正文起点标记文本，如 摘要")
    p6.add_argument("--force", action="store_true", help="目录已存在时覆盖")
    p7 = sub.add_parser("fields", help="从切片机械提取 cover.fields / tail.rubric YAML 片段")
    p7.add_argument("spec")
    p8 = sub.add_parser("run", help="一键：build → 样例 MD → 真实构建 → verify（0 FAIL 结案）")
    p8.add_argument("spec")
    p8.add_argument("--md", default=None, help="指定测试 MD（缺省自动生成 templates/<id>/sample.md）")
    args = ap.parse_args()

    if args.cmd == "build":
        print(json.dumps(build(args.spec, do_register=not args.no_register),
                         ensure_ascii=False, indent=2))
    elif args.cmd == "check":
        print(json.dumps(check(args.spec), ensure_ascii=False, indent=2))
    elif args.cmd == "detect":
        print(json.dumps(detect_blocks(Path(args.docx).expanduser(), marker=args.marker),
                         ensure_ascii=False, indent=2))
    elif args.cmd == "text":
        print(json.dumps(dump_text(args.docx), ensure_ascii=False, indent=2))
    elif args.cmd == "fields":
        print(json.dumps(extract_fields(args.spec), ensure_ascii=False, indent=2))
    elif args.cmd == "run":
        print(json.dumps(run_pipeline(args.spec, md=args.md),
                         ensure_ascii=False, indent=2))
    elif args.cmd == "init":
        print(json.dumps(init_template(args.docx, args.id, args.name,
                                       marker=args.marker, force=args.force),
                         ensure_ascii=False, indent=2))
    else:
        print(json.dumps(analyze(args.docx), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
