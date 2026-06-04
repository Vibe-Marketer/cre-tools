# cre-tools one-line bootstrap (Windows PowerShell)
#
# Usage:
#   irm https://raw.githubusercontent.com/Vibe-Marketer/cre-tools/main/setup.ps1 | iex
#
# Installs Bun if missing, installs/updates cre-tools from GitHub, then runs
# `cre setup` to fetch native binaries, log into LoopNet + Reonomy, and wire MCP.

$ErrorActionPreference = "Stop"

$Repo = "github:Vibe-Marketer/cre-tools"
$BunDir = Join-Path $env:USERPROFILE ".bun\bin"
$BunExe = Join-Path $BunDir "bun.exe"
$CreExe = Join-Path $BunDir "cre.exe"

function Add-ToCurrentAndUserPath {
    param([string]$Dir)

    if (-not ($env:Path.Split(';') -contains $Dir)) {
        $env:Path = "$Dir;$env:Path"
    }

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($null -eq $userPath) { $userPath = "" }
    $parts = $userPath.Split(';') | Where-Object { $_ -ne "" }
    if (-not ($parts -contains $Dir)) {
        $newPath = if ($userPath.TrimEnd(';') -eq "") { $Dir } else { "$($userPath.TrimEnd(';'));$Dir" }
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    }
}

Write-Host "==> CRE tools setup"

if (-not (Test-Path $BunExe)) {
    $existingBun = Get-Command bun -ErrorAction SilentlyContinue
    if ($existingBun) {
        $BunExe = $existingBun.Source
        $BunDir = Split-Path -Parent $BunExe
        $CreExe = Join-Path $BunDir "cre.exe"
    }
}

if (-not (Test-Path $BunExe)) {
    Write-Host "==> Installing Bun..."
    Invoke-RestMethod https://bun.sh/install.ps1 | Invoke-Expression
    if (-not (Test-Path $BunExe)) {
        throw "Bun install finished, but $BunExe was not found. Open a new PowerShell window and retry."
    }
} else {
    Write-Host "==> Bun already installed: $BunExe"
}

Add-ToCurrentAndUserPath $BunDir

Write-Host "==> Installing/updating cre-tools..."
& $BunExe add -g $Repo

if (-not (Test-Path $CreExe)) {
    $existingCre = Get-Command cre -ErrorAction SilentlyContinue
    if ($existingCre) {
        $CreExe = $existingCre.Source
    }
}

if (-not (Test-Path $CreExe)) {
    throw "cre-tools installed, but cre.exe was not found under $BunDir. Open a new PowerShell window and retry: cre setup"
}

Write-Host "==> Running cre setup..."
Write-Host "    Chrome will open for LoopNet and Reonomy. Log in normally when prompted."
Write-Host ""

if ($env:CRE_TOOLS_BOOTSTRAP_SKIP_SETUP -eq "1") {
    Write-Host "CRE_TOOLS_BOOTSTRAP_SKIP_SETUP=1 set; skipping interactive cre setup."
    & $CreExe --version
} else {
    & $CreExe setup
}
