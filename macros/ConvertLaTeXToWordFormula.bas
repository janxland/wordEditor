Attribute VB_Name = "modFormula"
Option Explicit

Sub ConvertLaTeXToWordFormula_Ultimate()
    Dim doc As Document
    Dim totalConverted As Integer
    totalConverted = 0

    Set doc = ActiveDocument
    Application.ScreenUpdating = False
    Application.DisplayAlerts = wdAlertsNone

    ' 优先处理 \(XXX\) 格式（你的文本中主要是这种格式）
    totalConverted = totalConverted + ProcessLaTeXFormat_Ultimate("\(", "\)")
    totalConverted = totalConverted + ProcessLaTeXFormat_Ultimate("$", "$") ' 兼容 $XXX$ 格式

    Application.ScreenUpdating = True
    Application.DisplayAlerts = wdAlertsAll

    If totalConverted > 0 Then
        MsgBox "转换完成！共处理 " & totalConverted & " 个 LaTeX 公式", vbInformation
    Else
        MsgBox "未找到可转换的 LaTeX 公式，请检查公式标记是否完整（如 \(\) 成对）", vbExclamation
    End If
End Sub

' 终极版处理子过程：修复查找逻辑+适配紧密排版的公式
Function ProcessLaTeXFormat_Ultimate(startTag As String, endTag As String) As Integer
    Dim doc As Document
    Dim rng As Range
    Dim startPos As Long, endPos As Long
    Dim latexCode As String, eqCode As String
    Dim convertedCount As Integer
    convertedCount = 0

    Set doc = ActiveDocument
    Set rng = doc.Content
    rng.Start = 0 ' 从文档开头开始查找

    Do While True
        ' 1. 精准查找起始标记（区分大小写，确保是 LaTeX 标记）
        startPos = InStr(rng.Start + 1, doc.Content.Text, startTag, vbBinaryCompare)
        If startPos = 0 Then Exit Do ' 无更多起始标记

        ' 2. 查找当前起始标记后的第一个结束标记（非贪婪匹配）
        endPos = InStr(startPos + Len(startTag), doc.Content.Text, endTag, vbBinaryCompare)
        If endPos = 0 Then Exit Do ' 无对应结束标记

        ' 3. 定位完整公式块（包含包裹符）
        Set rng = doc.Range(Start:=startPos - 1, End:=endPos + Len(endTag) - 1)

        ' 4. 优化纯文本校验：允许公式紧跟中文/标点（适配你的排版）
        If IsValidLaTeXRange(rng) Then
            ' 提取纯 LaTeX 代码
            latexCode = Mid(rng.Text, Len(startTag) + 1, Len(rng.Text) - Len(startTag) - Len(endTag))

            ' 转换为 Word 公式代码（新增支持绝对值、乘号等）
            eqCode = ConvertLaTeXToEQ_Ultimate(latexCode)

            ' 5. 替换操作：删除原文本，插入公式
            rng.Delete
            ' 重新定位插入位置（关键：避免因删除导致位置偏移）
            Set rng = doc.Range(Start:=startPos - 1, End:=startPos - 1)

            ' 插入专业格式公式（直接生成可编辑数学公式）
            With rng
                .InsertAfter vbNullString
                .Select
                ' 插入 EQ 域并强制更新
                Selection.Fields.Add _
                    Range:=.Range, _
                    Type:=wdFieldEmpty, _
                    Text:="EQ " & eqCode & " \* MERGEFORMAT", _
                    PreserveFormatting:=True
                .Fields(1).Update
                ' 转为静态公式（避免被再次识别，同时保持专业格式）
                .Fields(1).ConvertToStaticText
            End With

            convertedCount = convertedCount + 1
        End If

        ' 6. 修复查找范围：移动到当前公式之后，避免重复匹配
        rng.Start = endPos + Len(endTag) - 1
        If rng.Start >= doc.Content.End Then Exit Do ' 已到文档末尾
    Loop

    ProcessLaTeXFormat_Ultimate = convertedCount
End Function

' 优化版校验函数：适配紧密排版，允许公式紧跟中文/标点
Function IsValidLaTeXRange(rng As Range) As Boolean
    Dim i As Long
    ' 条件1：无公式对象/域（避免重复转换）
    If rng.InlineShapes.Count > 0 Or rng.Fields.Count > 0 Then
        IsValidLaTeXRange = False
        Exit Function
    End If

    ' 条件2：标记完整（起始和结束标记正确）
    Dim startTag As String, endTag As String
    startTag = Left(rng.Text, 2) ' 因为 \(\) 是2个字符，$是1个字符，这里兼容两种
    If startTag = "\(" Then
        endTag = "\)"
    ElseIf Left(rng.Text, 1) = "$" Then
        startTag = "$"
        endTag = "$"
    Else
        IsValidLaTeXRange = False
        Exit Function
    End If

    ' 条件3：包含有效 LaTeX 公式内容（非空）
    Dim content As String
    content = Mid(rng.Text, Len(startTag) + 1, Len(rng.Text) - Len(startTag) - Len(endTag))
    If Trim(content) = "" Then
        IsValidLaTeXRange = False
        Exit Function
    End If

    ' 条件4：仅包含 LaTeX 合法字符（新增支持绝对值 |、乘号 × 等）
    Dim allowedChars As String
    allowedChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-*/=<>≥≤()[]{}_,.;:!\$\\\text{}\|× "
    Dim char As String
    For i = 1 To Len(rng.Text)
        char = Mid(rng.Text, i, 1)
        If InStr(allowedChars, char) = 0 Then
            ' 允许中文/标点紧跟公式（仅校验公式内部字符）
            If i > Len(startTag) And i < Len(rng.Text) - Len(endTag) + 1 Then
                IsValidLaTeXRange = False
                Exit Function
            End If
        End If
    Next

    IsValidLaTeXRange = True
End Function

' 终极版转换函数：支持你的文本中所有公式语法
Function ConvertLaTeXToEQ_Ultimate(latexCode As String) As String
    Dim eqCode As String
    Dim braceCount As Integer, i As Integer
    eqCode = latexCode

    ' 1. 处理绝对值：\left| 和 \right| → |（Word 公式直接支持绝对值符号）
    eqCode = Replace(eqCode, "\left|", "|")
    eqCode = Replace(eqCode, "\right|", "|")

    ' 2. 处理乘号：\times → ×（Word 公式支持中文乘号，更直观）
    eqCode = Replace(eqCode, "\times", "×")

    ' 3. 处理下标：_{xxx} → \s(xxx)（支持中文下标，如 y_{预测}）
    eqCode = Replace(eqCode, "_{", "\s(")
    ' 处理多个 } 的情况（如下标后接其他内容）
    braceCount = 0
    For i = 1 To Len(eqCode)
        If Mid(eqCode, i, 1) = "{" Then braceCount = braceCount + 1
        If Mid(eqCode, i, 1) = "}" Then
            braceCount = braceCount - 1
            If braceCount = -1 Then ' 找到下标对应的 }
                eqCode = Left(eqCode, i - 1) & ")" & Mid(eqCode, i + 1)
                Exit For
            End If
        End If
    Next

    ' 4. 处理分数：\frac{分子}{分母} → \f(分子,分母)（支持复杂分子分母）
    eqCode = Replace(eqCode, "\frac{", "\f(")
    eqCode = Replace(eqCode, "}{", ",") ' 分子分母分隔符

    ' 5. 处理文本/单位：\text{xxx} → xxx（你的文本中无此格式，但保留兼容）
    eqCode = Replace(eqCode, "\text{", "")
    eqCode = Replace(eqCode, "}", "")

    ' 6. 处理向量/希腊字母：\omega → ω（Word 公式支持希腊字母）
    eqCode = Replace(eqCode, "\omega", "ω")
    eqCode = Replace(eqCode, "\delta", "δ")
    eqCode = Replace(eqCode, "\(PD_s\)", "PD\s(s)") ' 处理 PD_s 下标

    ' 7. 处理空格：\ → 空格，合并连续空格
    eqCode = Replace(eqCode, "\ ", " ")
    eqCode = Replace(eqCode, "  ", " ")

    ' 8. 处理百分比：% 直接保留（Word 公式支持）
    eqCode = Replace(eqCode, "\%", "%") ' 若有转义的 %，还原为 %

    ' 9. 处理向量符号：\(W\) → W（直接保留，无需额外处理）
    eqCode = Trim(eqCode)

    ConvertLaTeXToEQ_Ultimate = eqCode
End Function
