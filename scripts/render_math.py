#!/usr/bin/env python3
"""
预处理 Markdown：把行内 LaTeX (`\\(...\\)` / `$...$`) 渲染成 Unicode 可读数学。

设计目标：
  - 让 Word 里直接显示「可读、可复制」的数学，而不是依赖 EQ 域。
  - 兼容现有 wordEditor 管线：上游不变（MD），下游 pandoc/VBA 处理静态文本。

主要规则：
  - `\\dfrac` / `\\tfrac` → `\\frac`
  - `\\frac{a}{b}` → `(a)/(b)`（外层加括号，避免歧义；若 a/b 是单字符则去括号）
  - `_{...}` / `^{...}` 与单字符 `_x` / `^x`：尽量映射到 Unicode 下标 / 上标；失败则用 `_(...)` 形式
  - 常见命令：`\\cdot`→`·`、`\\times`→`×`、`\\pm`→`±`、`\\leq`/`\\geq`→`≤`/`≥`、希腊字母全集
  - `\\left|...\\right|` → `|...|`、`\\left(`/`\\right)` 等去除
  - `\\mathrm{xxx}` / `\\text{xxx}` → `xxx`
  - 兜底用 `pylatexenc.latex2text` 处理未覆盖语法
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

try:
    from pylatexenc.latex2text import LatexNodes2Text  # type: ignore
    _PYLE = LatexNodes2Text()
except Exception:  # noqa: BLE001
    _PYLE = None

SUB_MAP = {
    "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
    "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
    "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
    "a": "ₐ", "e": "ₑ", "h": "ₕ", "i": "ᵢ", "j": "ⱼ",
    "k": "ₖ", "l": "ₗ", "m": "ₘ", "n": "ₙ", "o": "ₒ",
    "p": "ₚ", "r": "ᵣ", "s": "ₛ", "t": "ₜ", "u": "ᵤ",
    "v": "ᵥ", "x": "ₓ",
}
SUP_MAP = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
    "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
    "n": "ⁿ", "i": "ⁱ",
}

GREEK = {
    r"\alpha": "α", r"\beta": "β", r"\gamma": "γ", r"\delta": "δ",
    r"\epsilon": "ε", r"\varepsilon": "ε", r"\zeta": "ζ", r"\eta": "η",
    r"\theta": "θ", r"\vartheta": "ϑ", r"\iota": "ι", r"\kappa": "κ",
    r"\lambda": "λ", r"\mu": "μ", r"\nu": "ν", r"\xi": "ξ",
    r"\pi": "π", r"\varpi": "ϖ", r"\rho": "ρ", r"\sigma": "σ",
    r"\tau": "τ", r"\upsilon": "υ", r"\phi": "φ", r"\varphi": "ϕ",
    r"\chi": "χ", r"\psi": "ψ", r"\omega": "ω",
    r"\Gamma": "Γ", r"\Delta": "Δ", r"\Theta": "Θ", r"\Lambda": "Λ",
    r"\Xi": "Ξ", r"\Pi": "Π", r"\Sigma": "Σ", r"\Upsilon": "Υ",
    r"\Phi": "Φ", r"\Psi": "Ψ", r"\Omega": "Ω",
}

OPS = {
    r"\cdot": "·", r"\times": "×", r"\div": "÷", r"\pm": "±", r"\mp": "∓",
    r"\leq": "≤", r"\geq": "≥", r"\neq": "≠", r"\approx": "≈",
    r"\equiv": "≡", r"\ll": "≪", r"\gg": "≫", r"\to": "→", r"\rightarrow": "→",
    r"\leftarrow": "←", r"\Rightarrow": "⇒", r"\Leftarrow": "⇐",
    r"\infty": "∞", r"\partial": "∂", r"\nabla": "∇", r"\forall": "∀",
    r"\exists": "∃", r"\in": "∈", r"\notin": "∉", r"\subset": "⊂",
    r"\subseteq": "⊆", r"\cup": "∪", r"\cap": "∩", r"\emptyset": "∅",
    r"\sum": "∑", r"\prod": "∏", r"\int": "∫", r"\sqrt": "√",
    r"\ldots": "…", r"\cdots": "⋯", r"\dots": "…",
    r"\,": " ", r"\;": " ", r"\:": " ", r"\!": "", r"\quad": "  ",
    r"\qquad": "    ",
}


def _strip_braces(s: str) -> str:
    """剥掉最外层 `{...}` 括号。"""
    s = s.strip()
    if len(s) >= 2 and s[0] == "{" and s[-1] == "}":
        depth = 0
        for i, ch in enumerate(s):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0 and i != len(s) - 1:
                    return s
        return s[1:-1].strip()
    return s


def _find_brace_group(s: str, start: int) -> tuple[str, int]:
    """从 `s[start]=='{'` 开始读取平衡花括号组，返回内部内容与结束位置（含 `}`）。"""
    assert s[start] == "{"
    depth = 0
    for i in range(start, len(s)):
        if s[i] == "{":
            depth += 1
        elif s[i] == "}":
            depth -= 1
            if depth == 0:
                return s[start + 1:i], i + 1
    return s[start + 1:], len(s)


def _to_subsup(text: str, table: dict[str, str]) -> str | None:
    """如果 `text` 中每个字符都能映射到 Unicode 下/上标，返回映射结果，否则 None。"""
    text = text.strip()
    if not text:
        return None
    out = []
    for ch in text:
        if ch in table:
            out.append(table[ch])
        else:
            return None
    return "".join(out)


def _render_subsup(s: str, sym: str, table: dict[str, str], fallback_fmt: str) -> str:
    """替换 `s` 中所有形如 `sym{...}` 或 `sym单字符` 的下/上标。"""
    out = []
    i = 0
    while i < len(s):
        if s[i] == sym and i + 1 < len(s):
            j = i + 1
            if s[j] == "{":
                body, end = _find_brace_group(s, j)
                body = _render(body)  # 先递归渲染再尝试映射
                mapped = _to_subsup(body, table)
                out.append(mapped if mapped is not None else fallback_fmt.format(body))
                i = end
                continue
            else:
                ch = s[j]
                mapped = table.get(ch)
                out.append(mapped if mapped is not None else fallback_fmt.format(ch))
                i = j + 1
                continue
        out.append(s[i])
        i += 1
    return "".join(out)


def _render_frac(s: str) -> str:
    """替换 `\\frac{a}{b}` → `(a)/(b)`；单字符或纯括号时省略外层括号。"""
    out = []
    i = 0
    while i < len(s):
        if s.startswith(r"\frac", i):
            j = i + len(r"\frac")
            while j < len(s) and s[j].isspace():
                j += 1
            if j < len(s) and s[j] == "{":
                num, j2 = _find_brace_group(s, j)
                k = j2
                while k < len(s) and s[k].isspace():
                    k += 1
                if k < len(s) and s[k] == "{":
                    den, k2 = _find_brace_group(s, k)
                    num_r = _render(num)
                    den_r = _render(den)
                    n_wrap = num_r if (len(num_r) == 1 or _is_wrapped(num_r)) else f"({num_r})"
                    d_wrap = den_r if (len(den_r) == 1 or _is_wrapped(den_r)) else f"({den_r})"
                    out.append(f"{n_wrap}/{d_wrap}")
                    i = k2
                    continue
        out.append(s[i])
        i += 1
    return "".join(out)


def _is_wrapped(s: str) -> bool:
    s = s.strip()
    if len(s) < 2 or s[0] != "(" or s[-1] != ")":
        return False
    depth = 0
    for ch in s[:-1]:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return False
    return depth == 1


# 简单的全词替换：从最长到最短，避免 `\delta` 被 `\del` 误吃
def _replace_commands(s: str, table: dict[str, str]) -> str:
    for cmd in sorted(table, key=len, reverse=True):
        s = re.sub(re.escape(cmd) + r"(?![A-Za-z])", lambda _m, v=table[cmd]: v, s)
    return s


def _render(latex: str) -> str:
    """主转换：返回 Unicode 数学文本。"""
    s = latex
    # 别名
    s = s.replace(r"\dfrac", r"\frac").replace(r"\tfrac", r"\frac")
    # \mathrm{xxx} / \text{xxx} / \mathbf{xxx} / \mathit{xxx} → xxx
    s = re.sub(r"\\(?:mathrm|text|mathbf|mathit|mathsf|mathcal|operatorname)\s*\{", "{__BARE__", s)

    # 处理括号去标记
    def _strip_bare(m: str) -> str:
        # 找到对应的 } 并去掉
        out = []
        i = 0
        while i < len(m):
            if m.startswith("{__BARE__", i):
                inner, end = _find_brace_group(m, i)
                inner = inner.replace("__BARE__", "", 1)
                out.append(_render(inner))
                i = end
                continue
            out.append(m[i])
            i += 1
        return "".join(out)

    s = _strip_bare(s)

    # \left| \right| → ||
    s = re.sub(r"\\left\|", "|", s)
    s = re.sub(r"\\right\|", "|", s)
    # 其它 \left / \right 删除
    s = re.sub(r"\\left([\(\[\{\.\|])", lambda m: m.group(1) if m.group(1) != "." else "", s)
    s = re.sub(r"\\right([\)\]\}\.\|])", lambda m: m.group(1) if m.group(1) != "." else "", s)

    # 分数
    s = _render_frac(s)

    # 下标 / 上标（fallback 用 Unicode 下标括号，避免被反复识别）
    s = _render_subsup(s, "_", SUB_MAP, "₍{}₎")
    s = _render_subsup(s, "^", SUP_MAP, "⁽{}⁾")

    # 希腊字母 + 运算符
    s = _replace_commands(s, GREEK)
    s = _replace_commands(s, OPS)

    # 余下的 \cmd → 用 pylatexenc 兜底
    if _PYLE is not None and "\\" in s:
        try:
            s = _PYLE.latex_to_text(s)
        except Exception:  # noqa: BLE001
            pass

    # 清理多余空格
    s = re.sub(r"[ \t]+", " ", s).strip()
    return s


# 行内 LaTeX 提取与替换 ---------------------------------------------------------

_PAREN_RE = re.compile(r"\\\((.+?)\\\)", re.DOTALL)
_DOLLAR_RE = re.compile(r"(?<!\$)\$(?!\$)([^\$\n]+?)\$(?!\$)")


def render_markdown(text: str) -> tuple[str, int]:
    """处理整段 Markdown，返回 (新文本, 替换数量)。仅替换行内数学。"""
    count = 0

    def _paren(m: re.Match) -> str:
        nonlocal count
        count += 1
        return _render(m.group(1).strip())

    def _dollar(m: re.Match) -> str:
        nonlocal count
        count += 1
        return _render(m.group(1).strip())

    out = _PAREN_RE.sub(_paren, text)
    out = _DOLLAR_RE.sub(_dollar, out)
    return out, count


def main() -> int:
    ap = argparse.ArgumentParser(description="把 MD 中的行内 LaTeX 预渲染为 Unicode 数学")
    ap.add_argument("input", type=Path, help="输入 .md")
    ap.add_argument("-o", "--output", type=Path, required=True, help="输出 .md")
    args = ap.parse_args()

    raw = args.input.read_text(encoding="utf-8")
    rendered, n = render_markdown(raw)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    print(f"[render_math] 已渲染 {n} 处行内 LaTeX → {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
