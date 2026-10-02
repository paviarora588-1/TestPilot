' TestPilot AI SAP GUI VBScript sample
On Error Resume Next

Dim SapGuiAuto, application, connection, session
Set SapGuiAuto = GetObject("SAPGUI")
Set application = SapGuiAuto.GetScriptingEngine
Set connection = application.Children(0)
Set session = connection.Children(0)

session.findById("wnd[0]/tbar[0]/okcd").Text = "/n/TRANSACTION"
session.findById("wnd[0]").sendVKey 0
session.findById("wnd[0]/usr/ctxtS_FUNC-LOW").Text = "AM_ANALYST"
session.findById("wnd[0]/tbar[1]/btn[8]").Press

If Err.Number <> 0 Then
  ' TODO: capture screenshot and write log
End If

If session.findById("wnd[0]/sbar").Text <> "" Then
  ' TODO: verify status/message
End If
