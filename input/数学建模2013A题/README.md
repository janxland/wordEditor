# 数学建模 2013 A 题示例

来源：学生提交的 docx《交通事故影响下的城市道路通行能力与排队长度预测研究》。
通过 `scripts/extract_docx_to_md.py` 提取得到本目录的 Markdown + 图片。

## 重新生成

```powershell
# 1. 从 docx 提取 → 当前目录
py scripts/extract_docx_to_md.py `
  -i <源 docx 路径> `
  -o "input/数学建模2013A题/车道被占用对城市道路通行能力的影响.md" `
  --image-dir "input/数学建模2013A题/images" `
  --image-rel "images"

# 2. 修复 OMML → 内联数学（启发式：补 \frac / \alpha 等命令的反斜杠；
#    含中文/编号 `#` 的行内"伪公式"降级为反引号代码块）
py scripts/tools/_repair_math_inline.py "input/数学建模2013A题/车道被占用对城市道路通行能力的影响.md"

# 3. 套用 hutb-math-modeling 模板导出 docx
py scripts/build.py -t hutb-math-modeling `
  -i "input/数学建模2013A题/车道被占用对城市道路通行能力的影响.md" `
  -o "output/数学建模2013A题.docx"
```

## 已知人工修补点

- YAML title / 顶级 `#` 标题：原 docx 封面页（含课程信息表）被剥除，统一以 `# 车道被占用对城市道路通行能力的影响` 起篇。
- 「四、 数据获取与处理」：原 docx 该段为正文样式而非 Heading，已手动改为 `# 数据获取与处理`。
- OMML 公式仅能取到 `m:t` 序列文本，结构丢失（如 `\frac{n_k}{n}` → `fracnkn`）。脚本对常见命令做了反斜杠补全；含 CJK / `#（编号）` 的伪公式整体降级为反引号代码，避免 Pandoc TeX 解析失败。
- 部分图片在原 docx 中重复引用同一 rId，导出后会看到 `image05` 之后的图序与正文 "图 N" 标号不连续，需要时按图注顺序在 Markdown 中删除多余 `![]()`。
