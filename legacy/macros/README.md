# legacy/macros — 历史 VBA 宏（已不在主管线中）

当前生产管线为 **Pandoc + Python 后处理**（参见仓库根 `README.md`），无需运行 Word VBA。

以下 `.bas` 文件保留供历史参考或在异常情况下手工修补 Word 文档时使用：

- `ApplyHeadingsAndRemoveNumbering.bas` — 应用标题样式并去除手动编号
- `ConvertLaTeXToWordFormula.bas` — 将 LaTeX 文本转 Word 公式
- `ManualRefToBookmarkSuperscript.bas` — 手动交叉引用转书签上标

**新成员请优先使用 Python 管线**，不要假设这些宏仍在使用。
