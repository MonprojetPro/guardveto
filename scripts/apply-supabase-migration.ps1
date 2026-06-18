# ============================================================
# GUARDVETO — Applique une migration SQL sur un projet Supabase
# via la Management API. Script GENERIQUE (toutes migrations).
#
# Usage :
#   powershell -ExecutionPolicy Bypass -File scripts/apply-supabase-migration.ps1 `
#     -Ref <project_ref> -SqlPath <chemin .sql>
#
# Le token est lu depuis la variable User Windows GUARDVETO_SUPABASE_TOKEN
# (jamais en clair). La migration doit etre idempotente.
# Controle de securite delegue a CERBERE + tests verts (voir CLAUDE.md).
# NB : le parametre s'appelle -SqlPath (et non -File) pour ne pas entrer en
#      conflit avec le switch -File de powershell.exe lui-meme.
# ============================================================
param(
  [Parameter(Mandatory=$true)][string]$Ref,
  [Parameter(Mandatory=$true)][string]$SqlPath
)
$ErrorActionPreference = 'Stop'

$t = [Environment]::GetEnvironmentVariable('GUARDVETO_SUPABASE_TOKEN','User')
if (-not $t) { Write-Error 'GUARDVETO_SUPABASE_TOKEN absent (niveau User Windows).'; exit 1 }
if (-not (Test-Path $SqlPath)) { Write-Error "Fichier introuvable : $SqlPath"; exit 1 }

$sql   = [string](Get-Content -Raw -Encoding UTF8 $SqlPath)
$body  = @{ query = $sql } | ConvertTo-Json -Depth 5 -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)

Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" `
  -Headers @{ Authorization = "Bearer $t" } -Method Post -Body $bytes `
  -ContentType 'application/json; charset=utf-8' | Out-Null

Write-Host "Migration appliquee : $SqlPath (projet $Ref)" -ForegroundColor Green
