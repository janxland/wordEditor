"""一次性工具：修复 extract_docx_to_md 输出中 OMML 退化为纯文本的内联公式。

将 `$...$` 内常见 LaTeX 命令名（无反斜杠）补上反斜杠，便于 MathJax/Pandoc 解析。
仅作启发式修复，复杂结构仍需人工调整。
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

CMDS = [
    "frac", "sum", "int", "prod", "sqrt", "alpha", "beta", "gamma", "delta",
    "theta", "lambda", "mu", "sigma", "pi", "omega", "infty", "cdot", "times",
    "quad", "qquad", "pm", "mp", "leq", "geq", "neq", "approx", "to", "left",
    "right", "partial", "nabla", "circ", "text", "mathrm", "begin", "end",
    "ldots", "dots", "cdots", "forall", "exists", "subset", "supset",
    "cup", "cap", "Delta", "Omega", "Sigma", "Pi", "Gamma", "Theta", "Lambda",
    "Phi", "phi", "epsilon", "varepsilon", "rho", "tau", "max", "min",
]


def repair(body: str) -> str:
    for cmd in sorted(CMDS, key=len, reverse=True):
        body = re.sub(rf"(?<![A-Za-z\\]){cmd}\b", "\\\\" + cmd, body)
    return body


_CJK_RE = re.compile(r"[\u4e00-\u9fff]")


def transform(match: re.Match) -> str:
    body = match.group(1)
    # 含中文、井号、全角括号 → 无法作为 TeX 解析，退化为反引号代码
    if _CJK_RE.search(body) or "#" in body or "（" in body or "）" in body:
        # 去掉公式末尾的孤立 "(式 NN)" 标号
        body = re.sub(r"[#（(]\s*式?\s*\d+\s*[）)]?\s*$", "", body).strip()
        if not body:
            return ""
        return f"`{body}`"
    return f"${repair(body)}$"


def main(argv: list[str]) -> int:
    p = Path(argv[1])
    s = p.read_text(encoding="utf-8")
    out = re.sub(r"\$([^$\n]{1,400}?)\$", transform, s)
    p.write_text(out, encoding="utf-8")
    print(f"修复完成: {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
