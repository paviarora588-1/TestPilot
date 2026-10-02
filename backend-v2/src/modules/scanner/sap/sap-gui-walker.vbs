' TestPilot SAP GUI Scanner (VBScript) — walks the currently active SAP GUI
' session's element tree via the official SAP GUI Scripting API and prints
' one JSON object (session info + an array of "screens") to stdout.
'
' This replaces an earlier PowerShell implementation (sap-gui-walker.ps1)
' that could not connect at all on a real test machine: .NET's [Marshal]::GetActiveObject("SAPGUI") failed with
' CO_E_CLASSSTRING even with scripting enabled, a live session open, and the
' correct 32-bit interpreter — while VBScript's native GetObject("SAPGUI"),
' calling the exact same underlying COM registration, connected successfully.
' This is a known category of quirk with older COM servers (SAP's own
' scripting API and its official recorder are VBScript/JScript-based, not
' .NET-based) — confirmed by direct, isolated testing against a live session
' before this file was written, not assumed.
'
' A second, separate quirk found during that same testing: this specific SAP
' GUI Scripting COM server's indexed collection methods (Children(i), etc.)
' fail — TypeName() returns Empty, Err raises 424/618 — when VBScript passes
' the index argument BY REFERENCE, which is VBScript's default calling
' convention for a bare variable. Wrapping the index in an extra set of
' parens, e.g. Children((i)) instead of Children(i), forces VBScript to
' evaluate it as an expression and pass it BY VALUE instead, which resolves
' it. This is applied at every indexed collection access below — do not
' remove the double parens, they are not a stylistic accident.
'
' A third quirk: reading the .Selected property on a GuiTab object raises
' Err 438 ("Object doesn't support this property or method") on this same
' server, even though .Select() (the method that actually switches to a tab)
' works fine. So tab walking below does not try to detect which tab was
' already active — it just selects and walks every tab found, then restores
' the first tab at the end as a reasonable default resting state, rather
' than the "leave it exactly as found" behavior the property would allow.
'
' Requires, on THIS machine, before this script can do anything:
'   1. SAP Logon connected with an active, logged-in session (not just the
'      connection picker sitting open), showing the screen to be scanned.
'   2. Scripting enabled client-side: SAP GUI Options > Accessibility &
'      Scripting > Scripting > "Enable scripting" — AND SAP Logon fully
'      restarted after enabling it; the setting does not apply retroactively
'      to an already-running session.
'   3. Scripting allowed server-side (Basis-controlled profile parameter
'      sapgui/user_scripting = TRUE on the system being connected to).
' If any of those aren't true, GetObject("SAPGUI") fails — this script
' reports that clearly on stderr rather than failing silently.
'
' Deliberately conservative about WHAT it interacts with: only GuiTab
' controls are ever selected. Every other button (Execute, Save, Post,
' Delete, Submit, ...) is captured as a scannable object but never pressed —
' those can commit real changes on a live SAP system, and this is a
' read-oriented scan, not a bot that presses whatever it finds.
'
' Tree controls (GuiShell with SubType "Tree" — the folder/outline navigators
' used throughout SAP config screens, e.g. Configuration > Central
' Configuration > Parameter Configuration) are NOT walkable via .Children at
' all — a Tree's node data lives behind its own API, entirely separate from
' the generic control tree every other object here is captured through.
' GetAllNodeKeys() returns every node's key regardless of expand/collapse
' state (no need to visually expand anything first), and GetNodeTextByKey(key)
' returns its real label — confirmed against a live Configuration tree, where
' it returned all 11 real node labels correctly. (GetItemText(key, column) —
' the column-tree/list-tree method — returned empty strings for this same
' tree; GetNodeTextByKey is the right call for a plain outline tree like this
' one.) Each node becomes a synthetic object with a locator of
' "<tree-id>#node=<key>" — trees have no natural direct addressing without
' also carrying the key info needed to later re-select or expand that node.
'
' Known limitation vs. the original PowerShell design: "multiple selection"
' value-help popups are not yet expanded by this version (the PS1 version
' pressed -VALU_PUSH buttons and captured the resulting popup) — only the
' base screen and its tabs are walked. Worth porting later if select-options
' popups turn out to matter for real scans; left out of this pass to ship
' the core (previously totally broken) capability first.
'
' Usage: cscript //nologo sap-gui-walker.vbs [connectionIndex] [sessionIndex]
' Both default to 0 (the first open connection/session) when omitted, same
' as this script's original always-grab-the-first behavior — pass explicit
' indices (from sap-gui-list-sessions.vbs's output) to target a specific one
' when more than one SAP GUI window is open.

Option Explicit

Dim TargetConnIndex, TargetSessIndex
TargetConnIndex = 0
TargetSessIndex = 0
If WScript.Arguments.Count >= 1 Then TargetConnIndex = CInt(WScript.Arguments(0))
If WScript.Arguments.Count >= 2 Then TargetSessIndex = CInt(WScript.Arguments(1))

Dim MaxNodes, MaxDepth, MaxTabs
MaxNodes = 2000
MaxDepth = 40
MaxTabs = 15

Dim InteractiveTypes
InteractiveTypes = Array("GuiTextField", "GuiCTextField", "GuiPasswordField", "GuiButton", "GuiTab", _
  "GuiCheckBox", "GuiRadioButton", "GuiComboBox", "GuiMenu", "GuiMenubar", _
  "GuiToolbarControl", "GuiOkCodeField", "GuiLabel", "GuiTableControl", "GuiGridView")

Function IsInteractiveType(t)
  Dim i
  IsInteractiveType = False
  For i = 0 To UBound(InteractiveTypes)
    If InteractiveTypes(i) = t Then
      IsInteractiveType = True
      Exit Function
    End If
  Next
End Function

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

Function ObjToJson(o)
  ObjToJson = "{""id"":""" & JsonEscape(o("id")) & """,""name"":""" & JsonEscape(o("name")) & _
    """,""type"":""" & JsonEscape(o("type")) & """,""text"":""" & JsonEscape(o("text")) & _
    """,""tooltip"":""" & JsonEscape(o("tooltip")) & """}"
End Function

' bucket: Scripting.Dictionary used as an ordered list (numeric-string keys)
' visited: Scripting.Dictionary used as a set (key existence only) — per
' screen, not global, since the same technical id can legitimately reappear
' across different tabs of the same transaction.
Sub WalkNode(node, depth, bucket, visited)
  If bucket.Count >= MaxNodes Or depth > MaxDepth Then Exit Sub

  Dim id
  id = ""
  On Error Resume Next
  id = node.Id
  If Err.Number <> 0 Then
    Err.Clear
    On Error Goto 0
    Exit Sub
  End If
  On Error Goto 0

  If id = "" Then Exit Sub
  If visited.Exists(id) Then Exit Sub
  visited.Add id, True

  Dim t, nm, tx, tt
  t = "" : nm = "" : tx = "" : tt = ""
  On Error Resume Next
  t = node.Type : Err.Clear
  nm = node.Name : Err.Clear
  tx = node.Text : Err.Clear
  tt = node.Tooltip : Err.Clear
  On Error Goto 0

  If IsInteractiveType(t) Then
    Dim rec
    Set rec = CreateObject("Scripting.Dictionary")
    rec.Add "id", id
    rec.Add "name", nm
    rec.Add "type", t
    rec.Add "text", tx
    rec.Add "tooltip", tt
    bucket.Add CStr(bucket.Count), rec
  End If

  ' Tree controls: capture every node via the tree's own node API instead of
  ' (fruitlessly) trying to find them via .Children below — see header
  ' comment. Does not recurse further into this node's .Children afterward;
  ' a tree's node data isn't reachable that way regardless.
  Dim subType
  subType = ""
  If t = "GuiShell" Then
    On Error Resume Next
    subType = node.SubType
    Err.Clear
    On Error Goto 0
  End If
  If subType = "Tree" Then
    On Error Resume Next
    Dim nodeKeys, nodeCount
    Set nodeKeys = node.GetAllNodeKeys
    nodeCount = -1
    If Err.Number = 0 Then nodeCount = nodeKeys.Count
    Err.Clear
    If nodeCount > 0 Then
      Dim ni
      For ni = 0 To nodeCount - 1
        If bucket.Count >= MaxNodes Then Exit For
        Dim nodeKey, nodeText
        nodeKey = nodeKeys((ni))
        Err.Clear
        nodeText = node.GetNodeTextByKey(nodeKey)
        Dim nodeTextErr
        nodeTextErr = Err.Number
        Err.Clear
        If nodeTextErr = 0 Then
          Dim treeRec
          Set treeRec = CreateObject("Scripting.Dictionary")
          treeRec.Add "id", id & "#node=" & nodeKey
          treeRec.Add "name", nodeKey
          treeRec.Add "type", "GuiTreeNode"
          treeRec.Add "text", nodeText
          treeRec.Add "tooltip", ""
          bucket.Add CStr(bucket.Count), treeRec
        End If
      Next
    End If
    On Error Goto 0
    Exit Sub
  End If

  On Error Resume Next
  Dim cnt
  cnt = -1
  cnt = node.Children.Count
  If Err.Number <> 0 Then cnt = -1
  Err.Clear
  On Error Goto 0

  If cnt > 0 Then
    Dim i
    For i = 0 To cnt - 1
      On Error Resume Next
      Dim child, gotChild
      Set child = node.Children((i)) ' by-value parens — see header comment
      gotChild = (Err.Number = 0) And IsObject(child)
      Err.Clear
      On Error Goto 0
      If gotChild Then WalkNode child, depth + 1, bucket, visited
    Next
  End If
End Sub

Function WalkScreen(node)
  Dim bucket, visited
  Set bucket = CreateObject("Scripting.Dictionary")
  Set visited = CreateObject("Scripting.Dictionary")
  WalkNode node, 0, bucket, visited
  Set WalkScreen = bucket
End Function

Function BucketToJsonArray(bucket)
  Dim parts, i
  parts = ""
  For i = 0 To bucket.Count - 1
    If i > 0 Then parts = parts & ","
    parts = parts & ObjToJson(bucket(CStr(i)))
  Next
  BucketToJsonArray = "[" & parts & "]"
End Function

' === Main ===
On Error Resume Next
Dim SapGuiAuto
Set SapGuiAuto = GetObject("SAPGUI")
If Err.Number <> 0 Then
  WScript.StdErr.WriteLine "{""error"":""Could not attach to a running SAP GUI (SAPGUI not found): " & _
    JsonEscape(Err.Description) & ". Confirm SAP Logon has an active connected session showing the target " & _
    "screen, and scripting is enabled (SAP GUI Options > Accessibility & Scripting) with SAP Logon fully " & _
    "restarted since.""}"
  WScript.Quit 1
End If
Err.Clear
On Error Goto 0

On Error Resume Next
Dim application
Set application = SapGuiAuto.GetScriptingEngine
If Err.Number <> 0 Then
  WScript.StdErr.WriteLine "{""error"":""GetScriptingEngine failed: " & JsonEscape(Err.Description) & _
    ". Scripting is likely disabled client-side or server-side (sapgui/user_scripting).""}"
  WScript.Quit 1
End If
Err.Clear
On Error Goto 0

If application.Children.Count = 0 Then
  WScript.StdErr.WriteLine "{""error"":""No SAP connections open. Log into a system in SAP Logon first.""}"
  WScript.Quit 1
End If
If TargetConnIndex >= application.Children.Count Then
  WScript.StdErr.WriteLine "{""error"":""Connection index " & TargetConnIndex & " does not exist (only " & _
    application.Children.Count & " connection(s) open).""}"
  WScript.Quit 1
End If

Dim connection
Set connection = application.Children((TargetConnIndex))
If connection.Children.Count = 0 Then
  WScript.StdErr.WriteLine "{""error"":""Connection '" & JsonEscape(connection.Description) & "' has no open sessions.""}"
  WScript.Quit 1
End If
If TargetSessIndex >= connection.Children.Count Then
  WScript.StdErr.WriteLine "{""error"":""Session index " & TargetSessIndex & " does not exist on connection '" & _
    JsonEscape(connection.Description) & "' (only " & connection.Children.Count & " session(s) open).""}"
  WScript.Quit 1
End If

Dim session
Set session = connection.Children((TargetSessIndex))

Dim sysName, client, usr, transaction, screenTitle
sysName = "" : client = "" : usr = "" : transaction = "" : screenTitle = ""
On Error Resume Next
sysName = session.Info.SystemName : Err.Clear
client = session.Info.Client : Err.Clear
usr = session.Info.User : Err.Clear
transaction = session.Info.Transaction : Err.Clear
screenTitle = session.Info.Title : Err.Clear
On Error Goto 0

Dim screens(50)
Dim screenCount
screenCount = 0

Dim baseObjects
On Error Resume Next
Set baseObjects = WalkScreen(session.ActiveWindow)
If Err.Number <> 0 Then
  WScript.StdErr.WriteLine "{""error"":""Failed while walking the active window: " & JsonEscape(Err.Description) & """}"
  WScript.Quit 1
End If
Err.Clear
On Error Goto 0

screens(screenCount) = "{""label"":""" & JsonEscape(screenTitle) & """,""context"":""base"",""objects"":" & _
  BucketToJsonArray(baseObjects) & "}"
screenCount = screenCount + 1

' --- Tabs: select and walk every GuiTab found on the base screen (bounded
' by MaxTabs). Cannot detect which tab was already active (see header
' comment on the .Selected quirk), so this always re-walks every tab
' including whichever one was active at scan start — harmless, just a
' little redundant for that one tab.
Dim tabCount, i
tabCount = 0
Dim firstTabId
firstTabId = ""
For i = 0 To baseObjects.Count - 1
  If tabCount >= MaxTabs Then Exit For
  Dim rec2
  Set rec2 = baseObjects(CStr(i))
  If rec2("type") = "GuiTab" Then
    If firstTabId = "" Then firstTabId = rec2("id")
    On Error Resume Next
    Dim tabObj
    Set tabObj = session.findById(rec2("id"))
    If Err.Number = 0 Then
      tabObj.Select
      Err.Clear
      WScript.Sleep 300
      Dim tabObjects
      Set tabObjects = WalkScreen(session.ActiveWindow)
      screens(screenCount) = "{""label"":""" & JsonEscape(rec2("text")) & """,""context"":""tab"",""objects"":" & _
        BucketToJsonArray(tabObjects) & "}"
      screenCount = screenCount + 1
      tabCount = tabCount + 1
    Else
      Err.Clear
    End If
    On Error Goto 0
  End If
Next
If firstTabId <> "" Then
  On Error Resume Next
  session.findById(firstTabId).Select
  Err.Clear
  On Error Goto 0
End If

Dim output
output = "{""session"":{""systemName"":""" & JsonEscape(sysName) & """,""client"":""" & JsonEscape(client) & _
  """,""user"":""" & JsonEscape(usr) & """,""transaction"":""" & JsonEscape(transaction) & _
  """,""screenTitle"":""" & JsonEscape(screenTitle) & """},""screens"":["
For i = 0 To screenCount - 1
  If i > 0 Then output = output & ","
  output = output & screens(i)
Next
output = output & "]}"

WScript.Echo output
