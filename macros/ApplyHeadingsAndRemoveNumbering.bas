Attribute VB_Name = "modHeadings"
Option Explicit

' 调试日志：写入 %TEMP%\wordeditor_macro.log
Private Sub DbgLog(msg As String)
    On Error Resume Next
    Dim fnum As Integer
    Dim path As String
    path = Environ("TEMP") & "\wordeditor_macro.log"
    fnum = FreeFile
    Open path For Append As #fnum
    Print #fnum, Format(Now, "hh:nn:ss") & " " & msg
    Close #fnum
    On Error GoTo 0
End Sub

' 设置内置标题样式（跨语言安全：使用 wdStyleHeading1..5 = -2..-6）
' 并清除任何遗留的首行/左/右缩进，避免标题前出现缩进符
' 关键：保留段落原本的 "1 / 1.1 / 1.1.1 / 一、" 编号前缀文字（用户要求）
Private Sub SetBuiltinHeading(p As Paragraph, level As Integer)
    On Error Resume Next
    ' wdStyleHeading1=-2, H2=-3, H3=-4, H4=-5, H5=-6
    p.Style = ActiveDocument.Styles(-1 - level)
    If Err.Number <> 0 Then
        Err.Clear
        p.Style = "标题 " & level
        If Err.Number <> 0 Then
            Err.Clear
            p.Style = "Heading " & level
        End If
    End If
    ' 强制清除编号 / 缩进 / 制表位
    p.Range.ListFormat.RemoveNumbers
    p.Format.LeftIndent = 0
    p.Format.RightIndent = 0
    p.Format.FirstLineIndent = 0
    p.Format.CharacterUnitLeftIndent = 0
    p.Format.CharacterUnitRightIndent = 0
    p.Format.CharacterUnitFirstLineIndent = 0
    p.Format.TabStops.ClearAll
    On Error GoTo 0
End Sub

Sub ApplyHeadingsAndRemoveNumbering()
    Dim para As Paragraph
    Dim paraText As String
    Dim i As Long
    Dim chineseNums As String
    chineseNums = "一二三四五六七八九十百千"

    Application.ScreenUpdating = False
    Application.DisplayAlerts = wdAlertsNone
    On Error Resume Next
    Application.Options.Pagination = False
    On Error GoTo 0

    DbgLog "START total=" & ActiveDocument.Paragraphs.Count

    ' 从最后一段向前处理，避免索引混乱
    For i = ActiveDocument.Paragraphs.Count To 1 Step -1
        If i Mod 10 = 0 Then DbgLog "loop i=" & i
        Set para = ActiveDocument.Paragraphs(i)
        paraText = Trim(para.Range.Text)

        If Len(paraText) = 0 Then GoTo ContinueLoop

        ' 中文 "一、标题" → H1（保留 "一、xxx" 文本）
        If Len(paraText) >= 2 And Mid(paraText, 2, 1) = "、" Then
            If InStr(chineseNums, Left(paraText, 1)) > 0 Then
                SetBuiltinHeading para, 1
                GoTo ContinueLoop
            End If
        End If
        ' x.x.x.x 形式 → H4（保留前缀）
        If paraText Like "[0-9].[0-9].[0-9].[0-9]* *" Then
            SetBuiltinHeading para, 4
            GoTo ContinueLoop
        End If
        ' x.x.x 形式 → H3
        If paraText Like "[0-9].[0-9].[0-9]* *" Then
            SetBuiltinHeading para, 3
            GoTo ContinueLoop
        End If
        ' x.x 形式 → H2
        If paraText Like "[0-9].[0-9]* *" Then
            ' 保证空格后再无 "."，排除 "1.1.1" 匹配
            Dim sp As Long
            sp = InStr(paraText, " ")
            If sp > 0 And InStr(Mid(paraText, sp + 1), ".") = 0 Then
                SetBuiltinHeading para, 2
                GoTo ContinueLoop
            End If
        End If

        ' 单独数字，如 "1"、"2 引言" → H1
        If paraText Like "[0-9]" Or paraText Like "[0-9] *" Then
            If IsNumeric(Left(paraText, 1)) Then
                SetBuiltinHeading para, 1
                GoTo ContinueLoop
            End If
        End If

ContinueLoop:
    Next i

    DbgLog "END"
    Application.ScreenUpdating = True
    Application.DisplayAlerts = wdAlertsAll
    On Error Resume Next
    Application.Options.Pagination = True
    On Error GoTo 0
End Sub
