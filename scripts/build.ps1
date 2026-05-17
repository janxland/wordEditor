# 一键 MD → Word（Windows PowerShell）
# 用法: .\scripts\build.ps1
#       .\scripts\build.ps1 -Input .\my.md -Template hutb-carbon-neutral

param(
    [string]$Input = "",
    [string]$Template = "",
    [switch]$ListTemplates
)

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$pyArgs = @("scripts/build.py")
if ($ListTemplates) { $pyArgs += "--list-templates" }
if ($Input) { $pyArgs += @("-i", $Input) }
if ($Template) { $pyArgs += @("-t", $Template) }

python @pyArgs
exit $LASTEXITCODE
