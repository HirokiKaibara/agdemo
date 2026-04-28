Attribute VB_Name = "SalesLegacyModule"

Public gTargetMonth As String
Public gTaxRate As Double
Public gOutPath As String
Public gUserName As String
Public gErrMsg As String
Public flg As Integer

Sub 売上請求作成()
    On Error Resume Next

    Dim wb, ws, wsInv, wsCus, wsItem, wsSum
    Dim i, j, k, outRow, lastRow, lastCus, lastItem
    Dim a, b, qty, price, amount, tax, total
    Dim saleNo, saleDate, customerCode, productCode
    Dim customerName, customerAddress, productName
    Dim csvPath, fileNo, lineText
    Dim sql, db
    Dim m1, m2, m3

    gTaxRate = 0.1
    flg = 0
    gUserName = Environ("USERNAME")
    gTargetMonth = Format(Date, "yyyymm")

    MsgBox "販売管理データ処理を開始します。"

    Application.ScreenUpdating = False
    Application.DisplayAlerts = False

    Set wb = ActiveWorkbook
    wb.Activate

    Worksheets("売上一覧").Select
    Cells.Select
    Selection.ClearContents

    csvPath = wb.Path & "\input\sales_" & gTargetMonth & ".csv"
    gOutPath = wb.Path & "\output\sales_" & gTargetMonth & ".csv"

    If Dir(csvPath) <> "" Then
        Workbooks.Open csvPath
        ActiveSheet.Cells.Select
        Selection.Copy
        wb.Activate
        Worksheets("売上一覧").Select
        Range("A1").Select
        ActiveSheet.Paste
        Workbooks(Dir(csvPath)).Close False
        MsgBox "売上一覧を読み込みました。"
    Else
        MsgBox "売上一覧CSVが見つかりません。シート上のデータをそのまま使います。"
    End If

    Worksheets("売上一覧").Select
    Range("A1").Select
    lastRow = Cells(Rows.Count, 1).End(xlUp).Row

    If lastRow < 2 Then
        MsgBox "売上データがありません。"
        GoTo EXIT_PROC
    End If

    Worksheets("月次集計").Select
    Cells.ClearContents
    Cells(1, 1).Value = "対象月"
    Cells(1, 2).Value = "売上番号"
    Cells(1, 3).Value = "顧客コード"
    Cells(1, 4).Value = "顧客名"
    Cells(1, 5).Value = "税抜金額"
    Cells(1, 6).Value = "消費税"
    Cells(1, 7).Value = "税込金額"

    outRow = 2
    m1 = 0
    m2 = 0
    m3 = 0

    For i = 2 To lastRow
        Worksheets("売上一覧").Select

        If Trim(Cells(i, 1).Value & "") = "" Then GoTo NEXT_ROW

        saleNo = Cells(i, 1).Value
        saleDate = Cells(i, 2).Value
        customerCode = Cells(i, 3).Value
        productCode = Cells(i, 5).Value
        qty = Val(Cells(i, 7).Value)
        a = Cells(i, 8).Value
        b = Cells(i, 9).Value

        customerName = ""
        customerAddress = ""
        productName = ""
        price = 0

        Worksheets("顧客").Select
        ActiveSheet.Range("A1").Select
        lastCus = Cells(Rows.Count, 1).End(xlUp).Row

        For j = 2 To lastCus
            If Cells(j, 1).Value = customerCode Then
                customerName = Cells(j, 2).Value
                customerAddress = Cells(j, 5).Value
                Exit For
            End If
        Next

        If customerName = "" Then
            MsgBox "顧客情報が見つかりません。顧客コード=" & customerCode
            flg = 1
        End If

        Worksheets("商品").Select
        Range("A1").Select
        lastItem = Cells(Rows.Count, 1).End(xlUp).Row

        For k = 2 To lastItem
            If Cells(k, 1).Value = productCode Then
                productName = Cells(k, 2).Value
                price = Val(Cells(k, 5).Value)
                Exit For
            End If
        Next

        If price = 0 Then
            price = Val(a)
        End If

        amount = qty * price
        tax = Int(amount * gTaxRate)
        total = amount + tax

        If b = "特価" Then
            amount = amount - 500
            tax = Int(amount * gTaxRate)
            total = amount + tax
        End If

        Worksheets("請求書").Select
        Range("B2").Select
        Cells(2, 2).Value = "サンプル商事"
        Cells(3, 2).Value = "請求書"
        Cells(4, 2).Value = customerName
        Cells(5, 2).Value = customerAddress
        Cells(7, 2).Value = saleNo
        Cells(7, 5).Value = saleDate
        Cells(10, 2).Value = productName
        Cells(10, 5).Value = qty
        Cells(10, 6).Value = price
        Cells(10, 7).Value = amount
        Cells(10, 8).Value = tax
        Cells(10, 9).Value = total
        Cells(12, 2).Value = "担当:" & gUserName
        Cells(13, 2).Value = "得意先ランク:" & 顧客ランク取得(customerCode)

        If Cells(1, 10).Value = "印刷" Then
            ActiveSheet.PrintPreview
            MsgBox "請求書の印刷プレビューを表示しました。"
        End If

        fileNo = FreeFile
        Open gOutPath For Append As #fileNo
        lineText = saleNo & "," & saleDate & "," & customerCode & "," & customerName & "," & productCode & "," & productName & "," & qty & "," & price & "," & amount & "," & tax & "," & total
        Print #fileNo, lineText
        Close #fileNo

        Worksheets("月次集計").Select
        Cells(outRow, 1).Value = gTargetMonth
        Cells(outRow, 2).Value = saleNo
        Cells(outRow, 3).Value = customerCode
        Cells(outRow, 4).Value = customerName
        Cells(outRow, 5).Value = amount
        Cells(outRow, 6).Value = tax
        Cells(outRow, 7).Value = total
        outRow = outRow + 1

        m1 = m1 + amount
        m2 = m2 + tax
        m3 = m3 + total

        sql = ""
        sql = sql & "UPDATE T_売上実績 "
        sql = sql & "SET 請求書出力済 = 1, "
        sql = sql & "更新者 = '" & gUserName & "', "
        sql = sql & "更新日時 = #" & Format(Now, "yyyy/mm/dd hh:nn:ss") & "# "
        sql = sql & "WHERE 売上番号 = '" & saleNo & "' "

        Set db = CurrentDb
        db.Execute sql

        If Err.Number <> 0 Then
            MsgBox "売上実績更新でエラーが発生しました。売上番号=" & saleNo
            gErrMsg = Err.Description
            Err.Clear
        End If

        sql = ""
        sql = sql & "INSERT INTO T_請求履歴(売上番号, 顧客コード, 商品コード, 請求金額, 税額, 登録者) VALUES("
        sql = sql & "'" & saleNo & "',"
        sql = sql & "'" & customerCode & "',"
        sql = sql & "'" & productCode & "',"
        sql = sql & amount & ","
        sql = sql & tax & ","
        sql = sql & "'" & gUserName & "')"
        db.Execute sql

        If total > 300000 Then
            MsgBox "高額売上です。承認要否を確認してください。"
        End If

        If Cells(1, 11).Value = "終了" Then GoTo EXIT_PROC

NEXT_ROW:
        DoEvents
    Next

    Worksheets("月次集計").Select
    Cells(1, 9).Value = "月次合計"
    Cells(2, 9).Value = m1
    Cells(2, 10).Value = m2
    Cells(2, 11).Value = m3

    sql = ""
    sql = sql & "DELETE FROM T_月次集計 WHERE 対象月 = '" & gTargetMonth & "'"
    db.Execute sql

    sql = ""
    sql = sql & "INSERT INTO T_月次集計(対象月, 売上金額, 税額, 請求金額, 更新者) VALUES("
    sql = sql & "'" & gTargetMonth & "',"
    sql = sql & m1 & ","
    sql = sql & m2 & ","
    sql = sql & m3 & ","
    sql = sql & "'" & gUserName & "')"
    db.Execute sql

    If flg = 1 Then
        MsgBox "一部警告があります。顧客マスタを確認してください。"
    Else
        MsgBox "販売管理データ処理が完了しました。"
    End If

EXIT_PROC:
    Application.CutCopyMode = False
    Application.DisplayAlerts = True
    Application.ScreenUpdating = True
End Sub

Function 顧客ランク取得(ByVal customerCode As String) As String
    On Error Resume Next

    Dim i, lastRow

    顧客ランク取得 = ""

    Worksheets("顧客").Select
    lastRow = Cells(Rows.Count, 1).End(xlUp).Row

    For i = 2 To lastRow
        If Cells(i, 1).Value = customerCode Then
            顧客ランク取得 = Cells(i, 7).Value
            Exit Function
        End If
    Next

    If 顧客ランク取得 = "" Then 顧客ランク取得 = "通常"
End Function

Sub 売上チェック()
    On Error Resume Next

    Dim i, lastRow, x

    Worksheets("売上一覧").Select
    lastRow = Cells(Rows.Count, 1).End(xlUp).Row

    For i = 2 To lastRow
        x = Val(Cells(i, 7).Value) * Val(Cells(i, 8).Value)
        If x <> Val(Cells(i, 10).Value) Then
            Cells(i, 12).Value = "金額不一致"
        End If
    Next

    MsgBox "チェック完了"
End Sub
