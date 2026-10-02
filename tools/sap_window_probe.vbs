Option Explicit

Dim shell, fso, outputPath, outFile
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
outputPath = shell.SpecialFolders("Desktop") & "\TestPilot-SAP-GUI-Window-Probe.txt"
Set outFile = fso.CreateTextFile(outputPath, True, False)

Sub Log(message)
  outFile.WriteLine Now & " - " & message
  outFile.Flush
End Sub

On Error Resume Next
Dim auto, app, connection, session, wnd, usr
Log "start"
Set auto = GetObject("SAPGUI")
Log "getobject err=" & CStr(Err.Number) & " " & Err.Description & " type=" & TypeName(auto)
Err.Clear
Set app = auto.GetScriptingEngine
Log "engine err=" & CStr(Err.Number) & " " & Err.Description & " type=" & TypeName(app)
Err.Clear
Log "connections=" & CStr(app.Children.Count)
Set connection = app.Children(0)
Log "connection err=" & CStr(Err.Number) & " " & Err.Description
Err.Clear
Log "sessions=" & CStr(connection.Children.Count)
Set session = connection.Children(0)
Log "session err=" & CStr(Err.Number) & " " & Err.Description
Err.Clear
Set wnd = session.FindById("wnd[0]")
Log "wnd err=" & CStr(Err.Number) & " " & Err.Description & " title=" & wnd.Text & " children=" & CStr(wnd.Children.Count)
Err.Clear
Set usr = session.FindById("wnd[0]/usr")
Log "usr err=" & CStr(Err.Number) & " " & Err.Description & " children=" & CStr(usr.Children.Count)
Err.Clear
Log "done"
outFile.Close
WScript.Echo "Probe complete: " & outputPath
