# JackDevOps local startup: API + web console + demo seed
# Usage: powershell -File scripts/start-local.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = 'd:\software\nvm\v22.22.0\node.exe'
if (-not (Test-Path $node)) { $node = 'node' }

Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# LLM credentials: reuse the local dsh harness credential store when present
$llmKey = $null
$credFile = Join-Path $env:USERPROFILE '.dsh\.credentials.yaml'
if (Test-Path $credFile) {
  $match = (Get-Content $credFile -Raw | Select-String -Pattern 'sk-[A-Za-z0-9\-_]+').Matches
  if ($match) { $llmKey = $match[0].Value }
}

$env:NODE_EXE = $node
$env:JACK_LLM_BASE_URL = 'http://lbai.ihanchen.com:21288/v1'
$env:JACK_LLM_API_KEY = $llmKey
$env:JACK_LLM_MODEL = 'Jfclaw-1.0'
$env:JACK_LLM_MAX_TOKENS = '4096'

Start-Process -FilePath $node -ArgumentList 'dist/main.js' -WorkingDirectory (Join-Path $root 'apps\server') -WindowStyle Hidden | Out-Null
Start-Process -FilePath $node -ArgumentList 'node_modules\vite\bin\vite.js','--port','5173','--host','0.0.0.0','--strictPort' -WorkingDirectory (Join-Path $root 'apps\web') -WindowStyle Hidden | Out-Null
Start-Sleep -Seconds 10

Invoke-RestMethod -Uri http://localhost:3000/demo/seed -Method Post -Headers @{ Authorization = 'Bearer dev-admin-token' } -ContentType 'application/json' -Body '{"actorId":"local"}' | Out-Null
Write-Output ''
Write-Output '=============================================='
Write-Output '  JackDevOps started'
Write-Output '  Console : http://localhost:5173'
Write-Output '  API     : http://localhost:3000'
Write-Output '  LAN     : http://192.168.85.85:5173 (same WiFi)'
Write-Output '  AI      : LLM enabled (Jfclaw-1.0 via .dsh credentials)'
Write-Output '  Stop    : Get-Process node | Stop-Process -Force'
Write-Output '=============================================='
