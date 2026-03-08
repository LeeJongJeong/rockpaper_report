$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$patterns = @('*.js', '*.html', '*.css', '*.md', '*.json', '*.ps1')
$issues = New-Object System.Collections.Generic.List[string]

function Test-TargetFile {
    param([string]$Name)

    foreach ($pattern in $patterns) {
        if ($Name -like $pattern) { return $true }
    }
    return $false
}

$replacementChar = [string][char]0xFFFD
$mojibakePattern = '[\u4E00-\u9FFF\uF900-\uFAFF][^\r\n]*\?|[?][^\r\n]*[\u4E00-\u9FFF\uF900-\uFAFF]|[\u3131-\u318E\u1100-\u11FF][^\r\n]*\?|[?][^\r\n]*[\u3131-\u318E\u1100-\u11FF]'
$doubleQuestionPattern = '(?<![?:])\?\?(?![?:])'

Get-ChildItem -Path $root -Recurse -File | Where-Object {
    Test-TargetFile $_.Name
} | ForEach-Object {
    $filePath = $_.FullName
    $lineNo = 0
    Get-Content -Path $filePath -Encoding UTF8 | ForEach-Object {
        $lineNo += 1
        $line = $_
        if ($line.Contains($replacementChar)) {
            $issues.Add("REPLACEMENT CHAR FOUND: ${filePath}:${lineNo}")
        }
        if ($line -match $mojibakePattern) {
            $issues.Add("SUSPECTED MOJIBAKE: ${filePath}:${lineNo}")
        }
        if ($line -match $doubleQuestionPattern -and $line -notmatch 'https?://') {
            $issues.Add("DOUBLE QUESTION MARK: ${filePath}:${lineNo}")
        }
    }
}

if ($issues.Count -gt 0) {
    $issues | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Output 'Text corruption check passed.'
