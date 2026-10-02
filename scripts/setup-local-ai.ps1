param(
    [switch]$SkipModelDownload,
    [switch]$WithVision,
    [switch]$SkipVisionModel
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $root ".tools\llama.cpp"
$modelDir = Join-Path $root ".tools\models"
$downloadDir = Join-Path $root ".tools\downloads"
$serverExe = Join-Path $runtimeDir "llama-server.exe"
$modelPath = Join-Path $modelDir "qwen2.5-1.5b-instruct-q4_k_m.gguf"
$modelUrl = "https://modelscope.cn/models/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/master/qwen2.5-1.5b-instruct-q4_k_m.gguf"
$modelSha256 = "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e"

# Vision model (screenshot -> test case feature). Optional — only fetched with -WithVision.
# Same llama-server.exe handles both; the vision model runs as a second local server on its own
# port (LOCAL_VISION_BASE_URL), loaded with --mmproj so it can see images. Zero-cost, fully local.
# Source: bartowski/Qwen2-VL-2B-Instruct-GGUF, mirrored on modelscope.cn (Apache-2.0) — the
# Hugging Face CDN (CloudFront/xet-bridge) 403s from some networks, modelscope does not.
$visionModelPath = Join-Path $modelDir "qwen2-vl-2b-instruct-q4_k_m.gguf"
$visionMmprojPath = Join-Path $modelDir "qwen2-vl-2b-instruct-mmproj-f16.gguf"
$visionModelUrl = "https://modelscope.cn/models/bartowski/Qwen2-VL-2B-Instruct-GGUF/resolve/master/Qwen2-VL-2B-Instruct-Q4_K_M.gguf"
$visionMmprojUrl = "https://modelscope.cn/models/bartowski/Qwen2-VL-2B-Instruct-GGUF/resolve/master/mmproj-Qwen2-VL-2B-Instruct-f16.gguf"

New-Item -ItemType Directory -Force $runtimeDir, $modelDir, $downloadDir | Out-Null

if (-not (Test-Path -LiteralPath $serverExe)) {
    Write-Host "Downloading the official llama.cpp CPU runtime..."
    $release = Invoke-RestMethod "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest" -Headers @{ "User-Agent" = "TestPilot-AI" }
    $asset = $release.assets | Where-Object { $_.name -match '^llama-.*-bin-win-cpu-x64\.zip$' } | Select-Object -First 1
    if (-not $asset) {
        throw "The latest llama.cpp release does not contain a Windows CPU x64 archive."
    }
    $archive = Join-Path $downloadDir $asset.name
    Invoke-WebRequest $asset.browser_download_url -OutFile $archive -UseBasicParsing
    Expand-Archive -LiteralPath $archive -DestinationPath $runtimeDir -Force
    if (-not (Test-Path -LiteralPath $serverExe)) {
        $found = Get-ChildItem -LiteralPath $runtimeDir -Recurse -Filter "llama-server.exe" | Select-Object -First 1
        if ($found) {
            Copy-Item -Path (Join-Path $found.DirectoryName "*") -Destination $runtimeDir -Recurse -Force
        }
    }
}

if (-not $SkipModelDownload -and -not (Test-Path -LiteralPath $modelPath)) {
    Write-Host "Downloading Qwen2.5 1.5B Q4_K_M (Apache-2.0 license, about 1.1 GB). This is a one-time download..."
    & curl.exe --ssl-no-revoke -L --fail --retry 5 --continue-at - --output $modelPath $modelUrl
    if ($LASTEXITCODE -ne 0) {
        throw "Model download failed with curl exit code $LASTEXITCODE. Run this script again to resume."
    }
}

if (-not (Test-Path -LiteralPath $serverExe)) {
    throw "llama-server.exe was not installed correctly."
}
if (-not $SkipModelDownload) {
    $model = Get-Item -LiteralPath $modelPath
    if ($model.Length -ne 1117320736) {
        throw "The model file is incomplete. Delete it and run this script again."
    }
    $actualSha256 = (Get-FileHash -LiteralPath $modelPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha256 -ne $modelSha256) {
        throw "The model checksum does not match the official Qwen artifact."
    }
}

if ($WithVision -and -not $SkipVisionModel) {
    if (-not (Test-Path -LiteralPath $visionModelPath)) {
        Write-Host "Downloading Qwen2-VL 2B Q4_K_M vision model (about 1.7 GB). This is a one-time download..."
        & curl.exe --ssl-no-revoke -L --fail --retry 5 --continue-at - --output $visionModelPath $visionModelUrl
        if ($LASTEXITCODE -ne 0) {
            throw "Vision model download failed with curl exit code $LASTEXITCODE. Run this script again with -WithVision to resume."
        }
    }
    if (-not (Test-Path -LiteralPath $visionMmprojPath)) {
        Write-Host "Downloading the matching mmproj vision projector (about 1.3 GB)..."
        & curl.exe --ssl-no-revoke -L --fail --retry 5 --continue-at - --output $visionMmprojPath $visionMmprojUrl
        if ($LASTEXITCODE -ne 0) {
            throw "mmproj download failed with curl exit code $LASTEXITCODE. Run this script again with -WithVision to resume."
        }
    }
    Write-Host "NOTE: unlike the text model above, this vision download is not checksum-verified in this script."
    Write-Host "If screenshot analysis fails to load, delete both files in .tools\models and re-run with -WithVision."
    Write-Host "Local vision AI (screenshot -> test case) is ready."
}
elseif (-not $WithVision) {
    Write-Host "Skipped the vision model (screenshot -> test case feature). Re-run with -WithVision to enable it."
}

Write-Host "Local AI setup is ready. TestPilot starts llama.cpp on demand; no API key or paid service is used."
