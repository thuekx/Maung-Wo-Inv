<#
 Maung-Wo-Inv — persiapan komputer Windows 10/11 untuk pengembangan/uji lokal.
 Memasang (via winget): Git, Node.js LTS, Docker Desktop; opsional Portainer.
 Lalu: npm install (api + web), prisma generate, membuat .env dengan secret acak.

 Jalankan di PowerShell *sebagai Administrator* dari folder repo:
   Set-ExecutionPolicy -Scope Process Bypass
   .\scripts\setup-windows.ps1              # install semua + npm install + .env
   .\scripts\setup-windows.ps1 -Portainer   # + Portainer (butuh Docker Desktop sudah berjalan)
   .\scripts\setup-windows.ps1 -Up          # + docker compose up + seed
#>
param([switch]$Portainer, [switch]$Up)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Install($id, $name) {
  Write-Host "==> $name" -ForegroundColor Cyan
  winget install --id $id -e --accept-package-agreements --accept-source-agreements --silent
}
if (-not (Has winget)) { throw "winget tidak ditemukan. Perbarui 'App Installer' dari Microsoft Store." }

if (-not (Has git))    { Install 'Git.Git' 'Git' }
function NodeMajor { if (Has node) { [int]((node -v).TrimStart('v').Split('.')[0]) } else { 0 } }
if ((NodeMajor) -lt 24) { Install 'OpenJS.NodeJS.LTS' 'Node.js 24 LTS' }
if (-not (Has docker)) {
  Install 'Docker.DockerDesktop' 'Docker Desktop (butuh WSL2; mungkin perlu restart)'
  Write-Host "Docker Desktop terpasang. Restart PC bila diminta, jalankan Docker Desktop, lalu ulangi skrip ini." -ForegroundColor Yellow
}

# PATH belum ter-refresh di sesi ini setelah winget
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')

if ((NodeMajor) -lt 24) { Write-Host "Buka PowerShell baru lalu jalankan ulang skrip ini (Node baru terpasang)." -ForegroundColor Yellow; exit 0 }

Write-Host "==> npm install (api)" -ForegroundColor Cyan
npm --prefix apps/api install
npm --prefix apps/api exec prisma generate
Write-Host "==> npm install (web)" -ForegroundColor Cyan
npm --prefix apps/web install

function Rand($bytes) { -join ((1..$bytes) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) }) }
if (-not (Test-Path .env)) {
  Write-Host "==> Membuat .env" -ForegroundColor Cyan
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  function Secret($n) { $b = New-Object byte[] $n; $rng.GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') }) }
  $c = Get-Content .env.example -Raw
  $c = $c -replace '(?m)^POSTGRES_PASSWORD=.*', "POSTGRES_PASSWORD=$(Secret 16)"
  $c = $c -replace '(?m)^JWT_SECRET=.*', "JWT_SECRET=$(Secret 32)"
  $c = $c -replace '(?m)^TELEGRAM_WEBHOOK_SECRET=.*', "TELEGRAM_WEBHOOK_SECRET=$(Secret 16)"
  $c = $c -replace '(?m)^BILLING_API_KEY=.*', "BILLING_API_KEY=$(Secret 24)"
  $c = $c -replace '(?m)^BILLING_WEBHOOK_SECRET=.*', "BILLING_WEBHOOK_SECRET=$(Secret 24)"
  [IO.File]::WriteAllText("$PWD\.env", $c, (New-Object Text.UTF8Encoding $false))
}

if ($Portainer) {
  if (-not (Has docker)) { throw "Docker belum tersedia." }
  if (-not (docker ps -a --format '{{.Names}}' | Select-String -SimpleMatch -Quiet 'portainer')) {
    docker volume create portainer_data | Out-Null
    docker run -d --name portainer --restart=always -p 9443:9443 -v //var/run/docker.sock:/var/run/docker.sock -v portainer_data:/data portainer/portainer-ce:lts
  }
  Write-Host "Portainer: https://localhost:9443 (buat admin dalam 5 menit pertama)" -ForegroundColor Green
}

if ($Up) {
  docker compose up -d --build
  Start-Sleep -Seconds 20
  docker compose exec -T api node dist/prisma/seed.js
  Write-Host "Web: http://localhost:3000  | API: http://localhost:4000" -ForegroundColor Green
}

Write-Host "`nSELESAI. Dev tanpa Docker: lihat README bagian 'Pengembangan lokal'." -ForegroundColor Green
