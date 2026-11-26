Set fso = CreateObject("Scripting.FileSystemObject")
panelDir = fso.GetParentFolderName(WScript.ScriptFullName)
rootDir = fso.GetParentFolderName(panelDir)
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = rootDir
WshShell.Run "node.exe src/launcher.js", 0, False
