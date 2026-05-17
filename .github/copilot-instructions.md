# Copilot Instructions — wordEditor

本工作区聚焦「Markdown → Word（带模板/页眉页脚/编号样式）」的批量产线，并集成了 VBA 三宏后处理闭环。在处理任何**学术写作类**任务时，请先查阅下述 Skills 再动手。

---

## Available Skills（学术写作 / 研究）

来源：[Imbad0202/academic-research-skills](https://github.com/Imbad0202/academic-research-skills) （已 clone 到 `vendor/academic-research-skills/`，CC BY-NC 4.0）。

任务触发到任何一个 skill 时，**先用 `read_file` 读取对应 SKILL.md 获取完整指令**，再按其工作流执行。

<skills>
<skill>
<name>academic-paper</name>
<description>12-agent academic paper writing pipeline. 10 modes (full/plan/outline/revision/revision-coach/abstract/lit-review/format-convert/citation-check/disclosure). 6 paper types, 5 citation formats, bilingual abstracts, LaTeX/DOCX-via-Pandoc/PDF output. Style Calibration + Writing Quality Check + Anti-Patterns with IRON RULE markers. Triggers: write paper, academic paper, guide my paper, parse reviews, AI disclosure, 写论文, 学术论文, 引导我写论文, 审查意见.</description>
<file>vendor/academic-research-skills/academic-paper/SKILL.md</file>
</skill>

<skill>
<name>academic-paper-reviewer</name>
<description>Multi-perspective academic paper review with 5 dynamic reviewer personas (EIC + 3 peer reviewers + Devil's Advocate). Modes: full review, re-review (verification), quick assessment, methodology focus, Socratic guided, calibration. Triggers: review paper, peer review, manuscript review, referee report, review my paper, critique paper, simulate review, editorial review.</description>
<file>vendor/academic-research-skills/academic-paper-reviewer/SKILL.md</file>
</skill>

<skill>
<name>academic-pipeline</name>
<description>Orchestrator for the full academic research pipeline: research → write → integrity check → review → revise → re-review → re-revise → final integrity check → finalize. Coordinates deep-research / academic-paper / academic-paper-reviewer into a 10-stage workflow with mandatory integrity verification, two-stage peer review, reproducible quality gates. Triggers: academic pipeline, research to paper, full paper workflow, end-to-end paper, complete paper workflow.</description>
<file>vendor/academic-research-skills/academic-pipeline/SKILL.md</file>
</skill>

<skill>
<name>deep-research</name>
<description>Universal 13-agent deep-research pipeline. 7 modes: full research, quick brief, paper review, lit-review, fact-check, Socratic guided research dialogue, systematic review (+ optional meta-analysis / PRISMA). Covers research-question formulation, methodology design, systematic search, source verification, cross-source synthesis, bias assessment, APA 7.0 report. Triggers: research, deep research, literature review, systematic review, meta-analysis, PRISMA, evidence synthesis, fact-check, guide my research, 研究, 深度研究, 文献回顾.</description>
<file>vendor/academic-research-skills/deep-research/SKILL.md</file>
</skill>
</skills>

### 选 skill 的快速决策

| 用户意图 | 选 skill |
|---------|---------|
| 「从零开始写一篇论文 / 全流程」 | `academic-pipeline`（编排器）|
| 「写一篇论文」「改一篇论文」「写摘要」「转 LaTeX」 | `academic-paper` |
| 「审稿」「同行评审」「模拟评审意见」 | `academic-paper-reviewer` |
| 「调研一个话题」「文献综述」「系统综述」「Meta-分析」「事实核查」 | `deep-research` |

### 与本工作区现有管线的衔接

学术 skill 产出 Markdown 后，可直接喂入本仓库的导出管线：

```powershell
py scripts/build.py -i 论文.md -t hutb-carbon-neutral  # 含 VBA 三宏后处理
py scripts/batch_build.py                              # 批量
```

详见 [README.md](README.md) 与 [macros/README.md](macros/README.md)。

---

## 本工作区核心要点

- **管线**：MD → Pandoc(`--reference-doc`) → DOCX → VBA 三宏（pywin32+Word COM）→ 成品。
- **三宏作用**：① 多级标题归一（中文「一、」/ `x.x` / `x.x.x` / `x.x.x.x` → Heading 2-5 并删除原编号）；② 行内 LaTeX(`\(...\)`/`$...$`) → Word EQ 域；③ `[N]` → 上标 + REF 域交叉引用（依赖 `<a id="RefN">` 书签）。
- **平台限制**：后处理需 Windows + 本机 Microsoft Word + `pywin32` + `HKCU\…\Word\Security\AccessVBOM=1`。
- **MD 端约定**（详见 [macros/README.md](macros/README.md)）：
  - 标题编号写为**普通段落**（不用 `##`），由宏改样式
  - 引用条目前加 `<a id="Ref1"></a>[1] …`，Pandoc HTML 管道会变成 Word 书签
- **常见坑**（参见 `/memories/repo/wordEditor-vba-pipeline.md`）：
  - `.bas` 文件必须按 `mbcs/GBK` 写出，UTF-8 / BOM 都会导致死锁或宏找不到
  - Word 必须 `Visible=True`（`Selection.Select` 在 Invisible 下死锁）
  - reference.docx 用英文 `Heading N`，宏用 `Styles(-2)…Styles(-5)` 跨语言安全
  - 保存前必须移除导入的 VBA 组件，否则 .docx 弹「丢失宏」对话框

---

## 工作风格

- 中文优先（用户偏好 `zh-cn`）
- 修改文件前先读，编辑后用 `get_errors` 校验
- 凡涉及 Word/COM 自动化的实验，先 `Get-Process WINWORD | Stop-Process -Force` 清场
- 本机 Python：`python` 是 WindowsApps stub，**用 `py`** 调用真正的 Python 3.12
- Pandoc 安装路径不在默认 PATH，需 `$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')` 刷新
