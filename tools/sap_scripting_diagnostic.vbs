Option Explicit

Dim shell, fso, outputPath, outFile
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
outputPath = shell.SpecialFolders("Desktop") & "\TestPilot-SAP-GUI-Diagnostic.txt"
Set outFile = fso.CreateTextFile(outputPath, True, False)

Sub Log(message)
  outFile.WriteLine Now & " - " & message
  outFile.Flush
End Sub

On Error Resume Next
Log "starting"

Dim SapGuiAuto, rotWrapper
Set SapGuiAuto = GetObject("SAPGUI")
If Err.Number <> 0 Then
  Log "GetObject SAPGUI failed: " & Err.Description
  Err.Clear
  Set rotWrapper = CreateObject("SapROTWr.SapROTWrapper")
  If Err.Number <> 0 Then
    Log "SapROTWrapper create failed: " & Err.Description
    outFile.Close
    WScript.Quit 1
  End If
  Set SapGuiAuto = rotWrapper.GetROTEntry("SAPGUI")
  If Err.Number <> 0 Then
    Log "SapROTWrapper GetROTEntry failed: " & Err.Description
    outFile.Close
    WScript.Quit 1
  End If
  Log "SAPGUI object attached through SapROTWrapper; type=" & TypeName(SapGuiAuto)
Else
  Log "SAPGUI object attached; type=" & TypeName(SapGuiAuto)
End If

Dim application
Set application = SapGuiAuto.GetScriptingEngine
If Err.Number <> 0 Then
  Log "GetScriptingEngine failed: " & Err.Description
  Err.Clear
  Set application = SapGuiAuto
  Log "using SAPGUI ROT entry directly as application"
End If
Log "scripting engine attached; connections=" & CStr(application.Children.Count)

Dim connection
Set connection = application.Children(0)
If Err.Number <> 0 Then
  Log "connection lookup failed: " & Err.Description
  outFile.Close
  WScript.Quit 1
End If
Log "connection attached; sessions=" & CStr(connection.Children.Count)

Dim session
Set session = connection.Children(0)
If Err.Number <> 0 Then
  Log "session lookup failed: " & Err.Description
  outFile.Close
  WScript.Quit 1
End If
Log "session attached"

Dim title
title = session.ActiveWindow.Text
If Err.Number <> 0 Then
  Log "active window title failed: " & Err.Description
  outFile.Close
  WScript.Quit 1
End If
Log "active window: " & title

Dim usr
Set usr = session.FindById("wnd[0]/usr")
If Err.Number <> 0 Then
  Log "wnd[0]/usr lookup failed: " & Err.Description
  outFile.Close
  WScript.Quit 1
End If
Log "wnd[0]/usr children=" & CStr(usr.Children.Count)

Log "done"
outFile.Close
WScript.Echo "Diagnostic complete: " & outputPath
