$ErrorActionPreference = 'Stop'

$utf8Script = Join-Path $PSScriptRoot 'check-utf8.ps1'
$corruptionScript = Join-Path $PSScriptRoot 'check-text-corruption.ps1'

& $utf8Script
& $corruptionScript

Write-Output 'Text integrity check passed.'
