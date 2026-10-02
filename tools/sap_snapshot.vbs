Option Explicit

Dim moduleName, featureName, outputPath
moduleName = "Snapshot"
featureName = "Current Screen"
outputPath = CreateObject("WScript.Shell").SpecialFolders("Desktop") & "\TestPilot-SAP-GUI-Snapshot.jsonl"
If WScript.Arguments.Count >= 1 Then moduleName = WScript.Arguments(0)
If WScript.Arguments.Count >= 2 Then featureName = WScript.Arguments(1)
If WScript.Arguments.Count >= 3 Then outputPath = WScript.Arguments(2)

Dim SapGuiAuto, application, connection, session, fso, outFile, visited
Set SapGuiAuto = GetObject("SAPGUI")
Set application = SapGuiAuto.GetScriptingEngine
Set connection = application.Children(0)
Set session = connection.Children(0)
Set fso = CreateObject("Scripting.FileSystemObject")
Set outFile = fso.OpenTextFile(outputPath, 8, True, -1)
Set visited = CreateObject("Scripting.Dictionary")

Sub AddRow(component)
  On Error Resume Next
  Dim id, name, typ, text, tooltip, title, key
  id = component.Id
  name = component.Name
  typ = component.Type
  text = component.Text
  tooltip = component.Tooltip
  title = session.ActiveWindow.Text
  key = id & "|" & title
  If Len(id) > 0 And Not visited.Exists(key) Then
    visited.Add key, True
    outFile.WriteLine "{""id"":""" & JsonEscape(id) & """,""name"":""" & JsonEscape(name) & """,""type"":""" & JsonEscape(typ) & """,""text"":""" & JsonEscape(text) & """,""tooltip"":""" & JsonEscape(tooltip) & """,""module"":""" & JsonEscape(moduleName) & """,""feature"":""" & JsonEscape(featureName) & """,""screen"":""" & JsonEscape(title) & """,""window_title"":""" & JsonEscape(title) & """,""knowledge_target"":true,""discovery_action"":""snapshot""}"
  End If
  On Error GoTo 0
End Sub

Sub Walk(component)
  On Error Resume Next
  AddRow component
  Dim child
  For Each child In component.Children
    Walk child
  Next
  On Error GoTo 0
End Sub

Function JsonEscape(value)
  Dim text
  text = CStr(value)
  text = Replace(text, "\", "\\")
  text = Replace(text, """", "\""")
  text = Replace(text, vbCrLf, "\n")
  text = Replace(text, vbCr, "\n")
  text = Replace(text, vbLf, "\n")
  JsonEscape = text
End Function

On Error Resume Next
Dim window
For Each window In session.Children
  Walk window
Next
outFile.Close
If Err.Number <> 0 Then
  WScript.Echo "Snapshot warning: " & Err.Description
  WScript.Quit 1
End If
WScript.Echo "Snapshot complete: " & outputPath
