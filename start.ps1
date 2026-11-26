param(
  [string]$Workspace = "",
  [switch]$Pick,
  [switch]$Gui
)

Set-Location $PSScriptRoot
$argsList = @("src/launcher.js")
if ($Pick) {
  $argsList += "--pick"
}
if ($Gui) {
  $argsList += "--gui"
}
if ($Workspace -ne "") {
  $argsList += "--workspace"
  $argsList += $Workspace
}

node @argsList
