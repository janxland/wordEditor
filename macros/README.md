# Word VBA 后处理宏

三个宏，由 `scripts/postprocess_word.py` 通过 COM 自动导入并执行；也可在 Word 里手动 Alt+F8 运行。

| 文件 | 入口宏 | 作用 |
|------|--------|------|
| `ApplyHeadingsAndRemoveNumbering.bas` | `ApplyHeadingsAndRemoveNumbering` | 识别「一、」/`1.1`/`1.1.1`/`1.1.1.1`/单独数字 → 套用「标题 2/3/4/5」并删除原编号 |
| `ConvertLaTeXToWordFormula.bas` | `ConvertLaTeXToWordFormula_Ultimate` | `\(...\)`、`$...$` 形式行内 LaTeX → Word EQ 域公式（可编辑） |
| `ManualRefToBookmarkSuperscript.bas` | `手动引用转书签交叉引用并设上标` | 正文 `[N]` → 上标 + REF 域交叉引用（依赖书签 `RefN`） |

## MD 端写法约定

### 标题编号
正文里直接写 `一、绪论` / `1.1 研究意义` / `1.1.1 数据来源` 等；标题层级由编号形式决定，宏会把它们改为对应的「标题 N」样式并删除编号文本。

### 行内公式
```
设损失函数 \(L = \frac{1}{n} \sum (y - y_{预测})^2\)，权重 $\omega$ 满足 \left| W \right| \leq 1。
```

### 参考文献 + 书签
在参考文献条目里用 HTML `<a id="RefN">` 标注书签（Pandoc HTML 管道会原样保留并由 Word 识别为书签）：
```markdown
# 参考文献

<a id="Ref1"></a>[1] Zhang S. 医疗经济风险预测. 中华医院管理, 2024.

<a id="Ref2"></a>[2] Li M. 数据挖掘方法对比. 统计研究, 2023.
```
正文里照常写 `[1]`、`[2]`。

## 已知限制

- 仅 Windows + 本机安装 Microsoft Word。
- 需开启「信任对 VBA 工程对象模型的访问」（`postprocess_word.py` 会自检并打印修复命令）。
- 宏中的 `MsgBox` 由 `postprocess_word.py` 在导入时静默化；如需弹窗，运行时加 `--interactive`。
