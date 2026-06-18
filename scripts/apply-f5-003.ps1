# ============================================================
# GUARDVETO — Applique la migration F5-003 (durcissement RLS V2)
# sur la base MPP `guardveto` (mpvrokmtwqlmhvxaaxdn).
# Migration 100% policies → reversible, ne touche aucune donnee.
# A lancer par MiKL (en son nom) :
#   ! powershell -ExecutionPolicy Bypass -File scripts/apply-f5-003.ps1
# ============================================================
$ErrorActionPreference = 'Stop'

$t = [Environment]::GetEnvironmentVariable('GUARDVETO_SUPABASE_TOKEN','User')
if (-not $t) { Write-Error 'GUARDVETO_SUPABASE_TOKEN absent (niveau User Windows).'; exit 1 }

$ref  = 'mpvrokmtwqlmhvxaaxdn'
$file = Join-Path $PSScriptRoot '..\supabase\migrations\20260618120000_f5_003_rls_v2_strict.sql'
# [string] force la mise a plat : sans ce cast, Get-Content -Raw garde des
# proprietes ETS et ConvertTo-Json emballe le SQL dans { "value": ... }
# => l'API repond "query: Expected string, received object". (PS 5.1)
$sql  = [string](Get-Content -Raw -Encoding UTF8 $file)

# 1. Appliquer la migration
$body  = @{ query = $sql } | ConvertTo-Json -Depth 5 -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
  -Headers @{ Authorization = "Bearer $t" } -Method Post -Body $bytes `
  -ContentType 'application/json; charset=utf-8' | Out-Null
Write-Host 'Migration F5-003 appliquee.' -ForegroundColor Green

# 2. Verification : policies des tables V2 + cabinets
$check  = @{ query = "select tablename, policyname, permissive, cmd from pg_policies where schemaname='public' and tablename in ('attributions','snapshots_regles','regles_version_courante','cabinets') order by tablename, policyname" } | ConvertTo-Json
$cbytes = [System.Text.Encoding]::UTF8.GetBytes($check)
$r = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
  -Headers @{ Authorization = "Bearer $t" } -Method Post -Body $cbytes `
  -ContentType 'application/json; charset=utf-8'
Write-Host "`nPolicies en place apres migration :" -ForegroundColor Cyan
$r | Format-Table -AutoSize
