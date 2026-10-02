Option Explicit

Dim targetId, label, moduleName, outputPath
If WScript.Arguments.Count < 4 Then
  WScript.Echo "Usage: cscript sap_focused_crawl.vbs <sap-id> <label> <module> <output-jsonl>"
  WScript.Quit 2
End If

targetId = WScript.Arguments(0)
label = WScript.Arguments(1)
moduleName = WScript.Arguments(2)
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
    outFile.WriteLine "{""id"":""" & JsonEscape(id) & """,""name"":""" & JsonEscape(name) & """,""type"":""" & JsonEscape(typ) & """,""text"":""" & JsonEscape(text) & """,""tooltip"":""" & JsonEscape(tooltip) & """,""module"":""" & JsonEscape(moduleName) & """,""feature"":""" & JsonEscape(label) & """,""screen"":""" & JsonEscape(title) & """,""window_title"":""" & JsonEscape(title) & """,""knowledge_target"":true,""discovery_action"":""" & JsonEscape(discoveryAction) & """}"
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

Sub WalkAllWindows(discoveryAction)
  On Error Resume Next
  Dim window
  For Each window In session.Children
    Walk window, discoveryAction
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

Sub SelectParentTabFromTarget()
  On Error Resume Next
  Dim marker, startPos, slashPos, tabId
  marker = "/tabp"
  startPos = InStr(1, targetId, marker, vbTextCompare)
  If startPos > 0 Then
    slashPos = InStr(startPos + Len(marker), targetId, "/")
    If slashPos > 0 Then
      tabId = Left(targetId, slashPos - 1)
    Else
      tabId = targetId
    End If
    session.FindById(tabId).Select
    WScript.Sleep 500
  End If
  On Error GoTo 0
End Sub

On Error Resume Next
SelectParentTabFromTarget
WalkAllWindows "before: " & label
session.FindById(targetId).Press
WScript.Sleep 1500
WalkAllWindows "after: " & label
If session.Children.Count > 1 Then
  session.Children(session.Children.Count - 1).SendVKey 12
  WScript.Sleep 300
Else
  session.FindById("wnd[0]").SendVKey 3
  WScript.Sleep 500
End If
WalkAllWindows "returned: " & label
outFile.Close
If Err.Number <> 0 Then
  WScript.Echo "Focused crawl warning for " & label & ": " & Err.Description
  WScript.Quit 1
End If
WScript.Echo "Focused crawl complete: " & label
