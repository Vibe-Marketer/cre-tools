# cre-tools standalone installer (Windows) — LoopNet + Reonomy
# No Node required. Downloads prebuilt binaries from the GitHub Release.
# Usage:  irm https://raw.githubusercontent.com/Vibe-Marketer/cre-tools/main/install.ps1 | iex
$ErrorActionPreference = "Stop"

$Repo       = "Vibe-Marketer/cre-tools"
$Version    = if ($env:CRE_TOOLS_VERSION) { $env:CRE_TOOLS_VERSION } else { "0.1.0" }
$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\cre-tools"
$BaseUrl    = "https://github.com/$Repo/releases/download/v$Version"

# --- Detect arch -------------------------------------------------------------
switch ($env:PROCESSOR_ARCHITECTURE) {
    "AMD64" { $Arch = "amd64" }
    "ARM64" { $Arch = "arm64" }
    "x86"   { $Arch = "amd64" }  # 32-bit shell on a 64-bit OS; binaries are 64-bit.
    default { Write-Error "cre-tools: unsupported architecture '$($env:PROCESSOR_ARCHITECTURE)'."; exit 1 }
}

Write-Host "==> cre-tools installer"
Write-Host "    Platform:  windows_$Arch"
Write-Host "    Release:   v$Version"
Write-Host "    Install to: $InstallDir"
Write-Host ""

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# --- Download the four binaries ----------------------------------------------
$Binaries = @("loopnet-pp-cli", "loopnet-pp-mcp", "reonomy-pp-cli", "reonomy-pp-mcp")
Write-Host "==> Downloading binaries..."
foreach ($name in $Binaries) {
    $asset = "${name}_windows_${Arch}.exe"
    $url   = "$BaseUrl/$asset"
    $dest  = Join-Path $InstallDir "$name.exe"
    Write-Host "  Downloading $asset ..." -NoNewline
    try {
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -ErrorAction Stop
        Write-Host " done"
    } catch {
        Write-Host " FAILED"
        Write-Error "cre-tools: download failed for $url`n  If release v$Version does not exist yet, set `$env:CRE_TOOLS_VERSION to a published tag."
        exit 1
    }
}

# --- Add install dir to user PATH (idempotent, persistent) -------------------
Write-Host ""
Write-Host "==> PATH check"
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($null -eq $UserPath) { $UserPath = "" }
$pathParts = $UserPath.Split(';') | Where-Object { $_ -ne "" }
if ($pathParts -contains $InstallDir) {
    Write-Host "  $InstallDir is already on your user PATH."
} else {
    $newPath = if ($UserPath.TrimEnd(';') -eq "") { $InstallDir } else { "$($UserPath.TrimEnd(';'));$InstallDir" }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    # Update the current session too, so the logins below resolve.
    $env:Path = "$env:Path;$InstallDir"
    Write-Host "  Added $InstallDir to your user PATH. Open a NEW terminal to pick it up everywhere."
}

# --- Auth logins -------------------------------------------------------------
Write-Host ""
Write-Host "==> Logging in to LoopNet + Reonomy"
Write-Host "    (A Chrome window will open for each — log in normally; it captures automatically.)"
Write-Host ""
$LoopnetExe = Join-Path $InstallDir "loopnet-pp-cli.exe"
$ReonomyExe = Join-Path $InstallDir "reonomy-pp-cli.exe"

Write-Host "Opening Chrome for LoopNet..."
try { & $LoopnetExe auth login } catch { Write-Host "  ! LoopNet login did not complete — re-run: loopnet-pp-cli auth login" }
Write-Host "Opening Chrome for Reonomy..."
try { & $ReonomyExe auth login } catch { Write-Host "  ! Reonomy login did not complete — re-run: reonomy-pp-cli auth login" }

Write-Host ""
Write-Host "================================================================"
Write-Host "  cre-tools installed."
Write-Host ""
Write-Host "  Verify connections:  loopnet-pp-cli doctor; reonomy-pp-cli doctor"
Write-Host "  Re-auth (Reonomy expires in 1-24h):  reonomy-pp-cli auth login"
Write-Host "================================================================"
