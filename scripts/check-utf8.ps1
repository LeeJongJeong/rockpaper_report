$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$patterns = @('*.js', '*.html', '*.css', '*.md', '*.json', '*.ps1')
$utf8 = New-Object System.Text.UTF8Encoding($false, $true)
$issues = @()

Get-ChildItem -Path $root -Recurse -File | Where-Object {
    $name = $_.Name
    foreach ($pattern in $patterns) {
        if ($name -like $pattern) { return $true }
    }
    return $false
} | ForEach-Object {
    $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
    try {
        [void]$utf8.GetString($bytes)
    } catch {
        $issues += "INVALID UTF-8: $($_.FullName)"
        return
    }

    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        $issues += "UTF-8 BOM FOUND: $($_.FullName)"
    }
}

if ($issues.Count -gt 0) {
    $issues | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Output 'UTF-8 check passed.'
