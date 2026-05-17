Attribute VB_Name = "modRefs"
Option Explicit

' 把正文中的「[N]」转成「[REF域]」（域指向书签 RefN），整段 [REF域] 设为上标。
' 参考文献条目里的 [N]（与书签 RefN 起点紧邻）跳过，保留为纯文本。
Sub 手动引用转书签交叉引用并设上标()
    Dim doc As Document
    Dim p As Paragraph
    Dim ptext As String
    Dim pos As Long, digitStart As Long, digitEnd As Long
    Dim matches() As Long
    Dim matchNums() As String
    Dim mCount As Long
    Dim i As Long, j As Long
    Dim baseStart As Long
    Dim refNum As String, bookmarkName As String
    Dim r As Range, fld As Field

    Set doc = ActiveDocument
    Application.ScreenUpdating = False
    Application.DisplayAlerts = wdAlertsNone
    On Error Resume Next
    Application.Options.Pagination = False
    Application.Options.CheckGrammarAsYouType = False
    Application.Options.CheckSpellingAsYouType = False
    On Error GoTo 0

    For i = 1 To doc.Paragraphs.Count
        Set p = doc.Paragraphs(i)
        ptext = p.Range.Text
        If Len(ptext) > 0 Then
            If Right(ptext, 1) = Chr(13) Then ptext = Left(ptext, Len(ptext) - 1)
        End If

        If InStr(ptext, "[") = 0 Then GoTo NextPara

        ReDim matches(31)
        ReDim matchNums(31)
        mCount = 0
        pos = 1
        Do
            pos = InStr(pos, ptext, "[")
            If pos = 0 Then Exit Do
            digitStart = pos + 1
            digitEnd = digitStart
            Do While digitEnd <= Len(ptext)
                If Not (Mid(ptext, digitEnd, 1) Like "[0-9]") Then Exit Do
                digitEnd = digitEnd + 1
            Loop
            If digitEnd > digitStart And digitEnd <= Len(ptext) Then
                If Mid(ptext, digitEnd, 1) = "]" Then
                    If mCount > UBound(matches) Then
                        ReDim Preserve matches(mCount + 31)
                        ReDim Preserve matchNums(mCount + 31)
                    End If
                    matches(mCount) = pos - 1
                    matchNums(mCount) = Mid(ptext, digitStart, digitEnd - digitStart)
                    mCount = mCount + 1
                    pos = digitEnd + 1
                    GoTo ContinueScan
                End If
            End If
            pos = pos + 1
ContinueScan:
        Loop

        If mCount = 0 Then GoTo NextPara

        baseStart = p.Range.Start
        For j = mCount - 1 To 0 Step -1
            refNum = matchNums(j)
            bookmarkName = "Ref" & refNum
            If Not doc.Bookmarks.Exists(bookmarkName) Then GoTo NextMatch
            ' 参考文献条目自身（书签起点紧邻 [N]）→ 不转域
            If Abs(doc.Bookmarks(bookmarkName).Range.Start - (baseStart + matches(j))) <= 1 Then GoTo NextMatch

            Set r = doc.Range(baseStart + matches(j), baseStart + matches(j) + 2 + Len(refNum))
            r.Delete
            r.InsertAfter "["
            r.Collapse wdCollapseEnd
            Set fld = doc.Fields.Add( _
                Range:=r, _
                Type:=wdFieldEmpty, _
                Text:="REF " & bookmarkName & " \h", _
                PreserveFormatting:=False)
            r.SetRange fld.Result.End, fld.Result.End
            r.InsertAfter "]"
            doc.Range(baseStart + matches(j), r.End).Font.Superscript = True
NextMatch:
        Next j
NextPara:
    Next i

    Application.ScreenUpdating = True
    Application.DisplayAlerts = wdAlertsAll
End Sub
