Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Environment("PROCESS")("BRIDGE_DAEMON") = "1"
shell.CurrentDirectory = projectDir & "\bridge-server"
shell.Run "node """ & projectDir & "\bridge-server\dist\index.js""", 0, False
