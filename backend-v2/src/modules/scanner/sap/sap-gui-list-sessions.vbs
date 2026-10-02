' Lists every open SAP GUI connection and session, so the caller can pick
' which one to scan instead of always grabbing connection[0]/session[0] —
' the SAP GUI equivalent of the web scanner's "list open browser tabs, pick
' one" flow. Read-only: never selects, presses, or navigates anything.
'
' Usage: cscript //nologo sap-gui-list-sessions.vbs

Option Explicit

Function JsonEscape(s)
  Dim out, i, c, code
  s = CStr(s)
  out = ""
  For i = 1 To Len(s)
    c = Mid(s, i, 1)
    Select Case c
      Case """": out = out & "\"""
      Case "\": out = out & "\\"
      Case vbCr: out = out & "\n"
      Case vbLf: out = out & "\n"
      Case vbTab: out = out & "\t"
      Case Else
        code = AscW(c)
        If code < 32 Then
          out = out & "\u" & Right("0000" & Hex(code), 4)
        Else
          out = out & c
        End If
    End Select
  Next
  JsonEscape = out
End Function

On Error Resume Next
Dim SapGuiAuto
Set SapGuiAuto = GetObject("SAPGUI")
If Err.Number <> 0 Then
  WScript.StdErr.WriteLine "{""error"":""Could not attach to a running SAP GUI: " & JsonEscape(Err.Description) & """}"
  WScript.Quit 1
End If
Err.Clear
On Error Goto 0

On Error Resume Next
Dim application
Set application = SapGuiAuto.GetScriptingEngine
If Err.Number <> 0 Then
  WScript.StdErr.WriteLine "{""error"":""GetScriptingEngine failed: " & JsonEscape(Err.Description) & """}"
  WScript.Quit 1
End If
Err.Clear
On Error Goto 0

Dim connCount
connCount = application.Children.Count

Dim entries
entries = ""
Dim entryCount
entryCount = 0

Dim ci
For ci = 0 To connCount - 1
  On Error Resume Next
  Dim conn, connDesc
  Set conn = application.Children((ci))
  connDesc = conn.Description
  Err.Clear

  Dim sessCount
  sessCount = conn.Children.Count
  Err.Clear
  On Error Goto 0

  Dim si
  For si = 0 To sessCount - 1
    On Error Resume Next
    Dim sess, sysN, cli, usr, tx, ti
    Set sess = conn.Children((si))
    sysN = "" : cli = "" : usr = "" : tx = "" : ti = ""
    sysN = sess.Info.SystemName : Err.Clear
    cli = sess.Info.Client : Err.Clear
    usr = sess.Info.User : Err.Clear
    tx = sess.Info.Transaction : Err.Clear
    ti = sess.Info.Title : Err.Clear
    On Error Goto 0

    If entryCount > 0 Then entries = entries & ","
    entries = entries & "{""connectionIndex"":" & ci & ",""sessionIndex"":" & si & _
      ",""connectionDescription"":""" & JsonEscape(connDesc) & """,""systemName"":""" & JsonEscape(sysN) & _
      """,""client"":""" & JsonEscape(cli) & """,""user"":""" & JsonEscape(usr) & _
      """,""transaction"":""" & JsonEscape(tx) & """,""title"":""" & JsonEscape(ti) & """}"
    entryCount = entryCount + 1
  Next
Next

WScript.Echo "[" & entries & "]"
