Option Explicit

If WScript.Arguments.Count < 4 Then
  WScript.Echo "Usage: cscript sap_select_snapshot.vbs <sap-id> <module> <feature> <output-jsonl>"
  WScript.Quit 2
End If

Dim targetId, moduleName, featureName, outputPath
targetId = WScript.Arguments(0)
moduleName = WScript.Arguments(1)
featureName = WScript.Arguments(2)
outputPath = WScript.Arguments(3)

Dim SapGuiAuto, application, connection, session, fso, outFile, visited
Set SapGuiAuto = GetObject("SAPGUI")
Set application = SapGuiAuto.GetScriptingEngine
Set connection = application.Children(0)
Set session = connection.Children(0)
Set fso = CreateObject("Scripting.FileSystemObject")
Set outFile = fso.OpenTextFile(outputPath, 8, True, -1)
Set visited = CreateObject("Scripting.Dictionary")

Sub AddRow(component, discoveryAction)
  On Error Resume Next
  Dim id, name, typ, text, tooltip, title, key
  id = component.Id
  name = component.Name
  typ = component.Type
  text = component.Text
  tooltip = component.Tooltip
  title = session.ActiveWindow.Text
  key = id & "|" & title & "|" & discoveryAction
  If Len(id) > 0 And Not visited.Exists(key) Then
    visited.Add key, True
    outFile.WriteLine "{""id"":""" & JsonEscape(id) & """,""name"":""" & JsonEscape(name) & """,""type"":""" & JsonEscape(typ) & """,""text"":""" & JsonEscape(text) & """,""tooltip"":""" & JsonEscape(tooltip) & """,""module"":""" & JsonEscape(moduleName) & """,""feature"":""" & JsonEscape(featureName) & """,""screen"":""" & JsonEscape(title) & """,""window_title"":""" & JsonEscape(title) & """,""knowledge_target"":true,""discovery_action"":""" & JsonEscape(discoveryAction) & """}"
  End If
  On Error GoTo 0
End Sub

Sub Walk(component, discoveryAction)
  On Error Resume Next
  AddRow component, discoveryAction
  Dim child
  For Each child In component.Children
    Walk child, discoveryAction
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
session.FindById(targetId).Select
WScript.Sleep 1000
Dim window
For Each window In session.Children
  Walk window, "selected: " & featureName
Next
outFile.Close
If Err.Number <> 0 Then
  WScript.Echo "Select snapshot warning: " & Err.Description
  WScript.Quit 1
End If
WScript.Echo "Select snapshot complete: " & outputPath
