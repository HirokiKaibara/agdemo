'============================================================
' 売掛・入金管理レガシーモジュール サンプル
' 関連元: SalesLegacyModule.bas
'
' このモジュールは SalesLegacyModule の処理結果に依存する想定です。
'
' 主な関連:
' - SalesLegacyModule.売上請求作成 で作成した output/sales_yyyymm.csv を読み込む
' - SalesLegacyModule のグローバル変数 gTargetMonth / gOutPath / gUserName / gErrMsg を参照
' - SalesLegacyModule.顧客ランク取得(customerCode) を呼び出す
' - 「月次集計」「顧客」「入金一覧」「売掛残高」「督促リスト」シートを参照する
'
' デモで解析しやすいポイント:
' - ファイル間依存
' - グローバル変数依存
' - シート名依存
' - CSV依存
' - DB更新SQL依存
' - GoTo / Select / On Error Resume Next の混在
' - 同じ顧客検索処理の重複
'============================================================

Public gNyukinPath As String
Public gReceivableOutPath As String
Public gWarningCount As Long
Public gTotalReceivable As Double
Public gTotalPaid As Double
Public gTotalRemain As Double

Sub 売掛入金突合作成()
    On Error Resume Next

    Dim wb, wsSales, wsPay, wsRec, wsDun, wsCus
    Dim i, j, k, r, p, lastSales, lastPay, lastCus
    Dim saleNo, saleDate, customerCode, customerName, productCode, productName
    Dim qty, price, amount, tax, total
    Dim payNo, payDate, payCustomerCode, paySaleNo, payAmount, payMethod
    Dim remain, rank, dueDate, delayDays, statusText, memoText
    Dim csvPath, payPath, outPath, fno, lineText, arr, tmp
    Dim sql, db
    Dim hitFlg, highFlg, ngFlg
    Dim mA, mB, mC, mD

    If gTargetMonth = "" Then
        gTargetMonth = Format(Date, "yyyymm")
    End If

    If gUserName = "" Then
        gUserName = Environ("USERNAME")
    End If

    Set wb = ActiveWorkbook
    wb.Activate

    Application.ScreenUpdating = False
    Application.DisplayAlerts = False

    MsgBox "売掛・入金突合処理を開始します。対象月=" & gTargetMonth

    csvPath = wb.Path & "\output\sales_" & gTargetMonth & ".csv"
    payPath = wb.Path & "\input\payments_" & gTargetMonth & ".csv"
    outPath = wb.Path & "\output\receivable_" & gTargetMonth & ".csv"

    gNyukinPath = payPath
    gReceivableOutPath = outPath
    gWarningCount = 0
    gTotalReceivable = 0
    gTotalPaid = 0
    gTotalRemain = 0

    If Dir(csvPath) = "" Then
        If gOutPath <> "" And Dir(gOutPath) <> "" Then
            csvPath = gOutPath
        Else
            MsgBox "売上請求出力CSVが見つかりません。先に 売上請求作成 を実行してください。"
            GoTo EXIT_PROC
        End If
    End If

    Worksheets("売掛残高").Select
    Cells.ClearContents
    Cells(1, 1).Value = "対象月"
    Cells(1, 2).Value = "売上番号"
    Cells(1, 3).Value = "売上日"
    Cells(1, 4).Value = "顧客コード"
    Cells(1, 5).Value = "顧客名"
    Cells(1, 6).Value = "請求金額"
    Cells(1, 7).Value = "入金額"
    Cells(1, 8).Value = "残高"
    Cells(1, 9).Value = "支払期限"
    Cells(1, 10).Value = "遅延日数"
    Cells(1, 11).Value = "状態"
    Cells(1, 12).Value = "顧客ランク"
    Cells(1, 13).Value = "メモ"

    Worksheets("督促リスト").Select
    Cells.ClearContents
    Cells(1, 1).Value = "顧客コード"
    Cells(1, 2).Value = "顧客名"
    Cells(1, 3).Value = "売上番号"
    Cells(1, 4).Value = "請求金額"
    Cells(1, 5).Value = "入金額"
    Cells(1, 6).Value = "残高"
    Cells(1, 7).Value = "遅延日数"
    Cells(1, 8).Value = "督促区分"
    Cells(1, 9).Value = "連絡先"
    Cells(1, 10).Value = "備考"

    Worksheets("入金一覧").Select
    Cells.ClearContents
    Cells(1, 1).Value = "入金番号"
    Cells(1, 2).Value = "入金日"
    Cells(1, 3).Value = "顧客コード"
    Cells(1, 4).Value = "売上番号"
    Cells(1, 5).Value = "入金額"
    Cells(1, 6).Value = "入金方法"

    If Dir(payPath) <> "" Then
        Workbooks.Open payPath
        ActiveSheet.Cells.Select
        Selection.Copy
        wb.Activate
        Worksheets("入金一覧").Select
        Range("A1").Select
        ActiveSheet.Paste
        Workbooks(Dir(payPath)).Close False
    Else
        MsgBox "入金CSVが見つかりません。既存の入金一覧シートを利用します。"
    End If

    Worksheets("入金一覧").Select
    lastPay = Cells(Rows.Count, 1).End(xlUp).Row

    r = 2
    p = 2
    fno = FreeFile
    Open outPath For Output As #fno
    Print #fno, "対象月,売上番号,売上日,顧客コード,顧客名,請求金額,入金額,残高,支払期限,遅延日数,状態,顧客ランク"

    Dim inNo As Integer
    Dim raw As String
    Dim col1, col2, col3, col4, col5, col6, col7, col8, col9, col10, col11

    inNo = FreeFile
    Open csvPath For Input As #inNo

    Do Until EOF(inNo)
        Line Input #inNo, raw
        If Trim(raw) = "" Then GoTo NEXT_LINE

        arr = Split(raw, ",")
        If UBound(arr) < 10 Then GoTo NEXT_LINE

        saleNo = arr(0)
        saleDate = arr(1)
        customerCode = arr(2)
        customerName = arr(3)
        productCode = arr(4)
        productName = arr(5)
        qty = Val(arr(6))
        price = Val(arr(7))
        amount = Val(arr(8))
        tax = Val(arr(9))
        total = Val(arr(10))

        If saleNo = "売上番号" Then GoTo NEXT_LINE

        payAmount = 0
        payDate = ""
        payMethod = ""
        hitFlg = 0

        Worksheets("入金一覧").Select
        For i = 2 To lastPay
            payNo = Cells(i, 1).Value
            payDate = Cells(i, 2).Value
            payCustomerCode = Cells(i, 3).Value
            paySaleNo = Cells(i, 4).Value

            If paySaleNo = saleNo Then
                payAmount = payAmount + Val(Cells(i, 5).Value)
                payMethod = Cells(i, 6).Value
                hitFlg = 1
            Else
                If paySaleNo = "" And payCustomerCode = customerCode Then
                    If Val(Cells(i, 5).Value) = total Then
                        payAmount = payAmount + Val(Cells(i, 5).Value)
                        payMethod = Cells(i, 6).Value
                        hitFlg = 1
                    End If
                End If
            End If
        Next

        remain = total - payAmount
        dueDate = DateAdd("d", 30, CDate(saleDate))
        delayDays = DateDiff("d", dueDate, Date)
        If delayDays < 0 Then delayDays = 0

        rank = 顧客ランク取得(customerCode)
        statusText = ""
        memoText = ""
        highFlg = 0
        ngFlg = 0

        If remain <= 0 Then
            statusText = "入金済"
            memoText = "消込済"
        Else
            If hitFlg = 0 Then
                statusText = "未入金"
                memoText = "入金データなし"
                gWarningCount = gWarningCount + 1
            Else
                statusText = "一部入金"
                memoText = "差額確認"
                gWarningCount = gWarningCount + 1
            End If
        End If

        If remain > 0 And delayDays > 0 Then
            statusText = statusText & "・期限超過"
            ngFlg = 1
        End If

        If total >= 300000 Or rank = "重要" Or rank = "A" Then
            highFlg = 1
        End If

        If highFlg = 1 And remain > 0 Then
            memoText = memoText & " 高額または重要顧客"
        End If

        Worksheets("売掛残高").Select
        Cells(r, 1).Value = gTargetMonth
        Cells(r, 2).Value = saleNo
        Cells(r, 3).Value = saleDate
        Cells(r, 4).Value = customerCode
        Cells(r, 5).Value = customerName
        Cells(r, 6).Value = total
        Cells(r, 7).Value = payAmount
        Cells(r, 8).Value = remain
        Cells(r, 9).Value = dueDate
        Cells(r, 10).Value = delayDays
        Cells(r, 11).Value = statusText
        Cells(r, 12).Value = rank
        Cells(r, 13).Value = memoText
        r = r + 1

        If remain > 0 And delayDays >= 1 Then
            Worksheets("督促リスト").Select
            Cells(p, 1).Value = customerCode
            Cells(p, 2).Value = customerName
            Cells(p, 3).Value = saleNo
            Cells(p, 4).Value = total
            Cells(p, 5).Value = payAmount
            Cells(p, 6).Value = remain
            Cells(p, 7).Value = delayDays

            If delayDays >= 60 Then
                Cells(p, 8).Value = "強督促"
            ElseIf delayDays >= 30 Then
                Cells(p, 8).Value = "通常督促"
            Else
                Cells(p, 8).Value = "確認連絡"
            End If

            Cells(p, 9).Value = 顧客連絡先取得(customerCode)
            Cells(p, 10).Value = memoText
            p = p + 1
        End If

        lineText = gTargetMonth & "," & saleNo & "," & saleDate & "," & customerCode & "," & customerName & "," & total & "," & payAmount & "," & remain & "," & dueDate & "," & delayDays & "," & statusText & "," & rank
        Print #fno, lineText

        gTotalReceivable = gTotalReceivable + total
        gTotalPaid = gTotalPaid + payAmount
        gTotalRemain = gTotalRemain + remain

        sql = ""
        sql = sql & "DELETE FROM T_売掛残高 WHERE 対象月 = '" & gTargetMonth & "' AND 売上番号 = '" & saleNo & "'"
        Set db = CurrentDb
        db.Execute sql

        sql = ""
        sql = sql & "INSERT INTO T_売掛残高(対象月, 売上番号, 顧客コード, 請求金額, 入金額, 残高, 状態, 更新者) VALUES("
        sql = sql & "'" & gTargetMonth & "',"
        sql = sql & "'" & saleNo & "',"
        sql = sql & "'" & customerCode & "',"
        sql = sql & total & ","
        sql = sql & payAmount & ","
        sql = sql & remain & ","
        sql = sql & "'" & statusText & "',"
        sql = sql & "'" & gUserName & "')"
        db.Execute sql

        If Err.Number <> 0 Then
            gErrMsg = Err.Description
            Err.Clear
        End If

NEXT_LINE:
        DoEvents
    Loop

    Close #inNo
    Close #fno

    Call 売掛集計表作成

    If gWarningCount > 0 Then
        MsgBox "売掛・入金突合が完了しました。確認対象=" & gWarningCount & "件"
    Else
        MsgBox "売掛・入金突合が完了しました。"
    End If

EXIT_PROC:
    Application.CutCopyMode = False
    Application.DisplayAlerts = True
    Application.ScreenUpdating = True
End Sub

Function 顧客連絡先取得(ByVal customerCode As String) As String
    On Error Resume Next

    Dim i, lastCus

    顧客連絡先取得 = ""

    Worksheets("顧客").Select
    lastCus = Cells(Rows.Count, 1).End(xlUp).Row

    For i = 2 To lastCus
        If Cells(i, 1).Value = customerCode Then
            顧客連絡先取得 = Cells(i, 6).Value
            Exit Function
        End If
    Next

    If 顧客連絡先取得 = "" Then
        顧客連絡先取得 = "未登録"
    End If
End Function

Sub 売掛集計表作成()
    On Error Resume Next

    Dim i, j, lastRow, outRow
    Dim customerCode, customerName, rank
    Dim totalBill, totalPay, totalRemain
    Dim ws
    Dim findFlg

    Worksheets("売掛残高").Select
    lastRow = Cells(Rows.Count, 1).End(xlUp).Row

    Worksheets("売掛集計").Select
    Cells.ClearContents
    Cells(1, 1).Value = "対象月"
    Cells(1, 2).Value = "顧客コード"
    Cells(1, 3).Value = "顧客名"
    Cells(1, 4).Value = "顧客ランク"
    Cells(1, 5).Value = "請求合計"
    Cells(1, 6).Value = "入金合計"
    Cells(1, 7).Value = "残高合計"
    Cells(1, 8).Value = "判定"

    outRow = 2

    Worksheets("売掛残高").Select
    For i = 2 To lastRow
        customerCode = Cells(i, 4).Value
        customerName = Cells(i, 5).Value
        rank = Cells(i, 12).Value

        If customerCode = "" Then GoTo NEXT_I

        Worksheets("売掛集計").Select
        findFlg = 0
        For j = 2 To outRow - 1
            If Cells(j, 2).Value = customerCode Then
                Cells(j, 5).Value = Val(Cells(j, 5).Value) + Val(Worksheets("売掛残高").Cells(i, 6).Value)
                Cells(j, 6).Value = Val(Cells(j, 6).Value) + Val(Worksheets("売掛残高").Cells(i, 7).Value)
                Cells(j, 7).Value = Val(Cells(j, 7).Value) + Val(Worksheets("売掛残高").Cells(i, 8).Value)
                findFlg = 1
                Exit For
            End If
        Next

        If findFlg = 0 Then
            Cells(outRow, 1).Value = gTargetMonth
            Cells(outRow, 2).Value = customerCode
            Cells(outRow, 3).Value = customerName
            Cells(outRow, 4).Value = rank
            Cells(outRow, 5).Value = Worksheets("売掛残高").Cells(i, 6).Value
            Cells(outRow, 6).Value = Worksheets("売掛残高").Cells(i, 7).Value
            Cells(outRow, 7).Value = Worksheets("売掛残高").Cells(i, 8).Value
            outRow = outRow + 1
        End If

NEXT_I:
        Worksheets("売掛残高").Select
    Next

    Worksheets("売掛集計").Select
    For i = 2 To outRow - 1
        If Val(Cells(i, 7).Value) = 0 Then
            Cells(i, 8).Value = "問題なし"
        ElseIf Val(Cells(i, 7).Value) >= 500000 Then
            Cells(i, 8).Value = "要確認"
        Else
            Cells(i, 8).Value = "残高あり"
        End If
    Next
End Sub

Sub 売掛デモ一括実行()
    On Error Resume Next

    ' SalesLegacyModule.bas 側の処理を先に実行する。
    ' この呼び出しにより output/sales_yyyymm.csv が作成される想定。
    Call 売上請求作成

    ' 続けて本モジュール側で売掛・入金突合を行う。
    Call 売掛入金突合作成
End Sub
