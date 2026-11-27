# Local PostgreSQL 17 rehearsal: replays supabase/migrations 000-059 into a scratch database and runs the schema
# fingerprint contract. Local only: no Docker, no hosted project, no ledger, no reset of anything but the scratch database.
#
# Usage (PowerShell):
#   .\supabase\verification\rehearsal\run-pg17-rehearsal.ps1 -PgBin "C:\Program Files\PostgreSQL\17\bin" -Port 54317 -Scratch "C:\path\outside\repo"
param(
  [Parameter(Mandatory = $true)] [string] $PgBin,
  [int] $Port = 54317,
  [Parameter(Mandatory = $true)] [string] $Scratch,
  [int] $MaxMigration = 59,
  [string] $Database = 'rehearsal'
)
# psql writes NOTICE lines to stderr; PowerShell would turn them into errors under 'Stop', so success is judged by exit code.
$ErrorActionPreference = 'Continue'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$psql = Join-Path $PgBin 'psql.exe'
$initdb = Join-Path $PgBin 'initdb.exe'
$pgctl = Join-Path $PgBin 'pg_ctl.exe'
New-Item -ItemType Directory -Force -Path $Scratch | Out-Null
$data = Join-Path $Scratch 'data'

if (-not (Test-Path (Join-Path $data 'PG_VERSION'))) {
  & $initdb -D $data -U postgres --auth=trust -E UTF8 | Out-Null
}
$running = & $pgctl -D $data status 2>$null
if ($LASTEXITCODE -ne 0) {
  & $pgctl -D $data -l (Join-Path $Scratch 'server.log') -o "-p $Port" -w start | Out-Null
}

$conn = @('-h', '127.0.0.1', '-p', "$Port", '-U', 'postgres')
& $psql @conn -At -c "drop database if exists $Database" -c "create database $Database" -c "alter database $Database set search_path to extensions, public" | Out-Null
& $psql @conn -d $Database -v ON_ERROR_STOP=1 -q -f (Join-Path $PSScriptRoot 'roles.sql') -f (Join-Path $PSScriptRoot 'stubs.sql')
if ($LASTEXITCODE -ne 0) { throw 'stub setup failed' }

$files = Get-ChildItem (Join-Path $repo 'supabase\migrations') -Filter '*.sql' |
  Where-Object { $_.Name -match '^(\d{3})_' -and [int]$matches[1] -le $MaxMigration } | Sort-Object Name
$applied = 0
foreach ($f in $files) {
  & $psql @conn -d $Database -v ON_ERROR_STOP=1 -q -f $f.FullName | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "migration failed: $($f.Name)" }
  $applied++
}
Write-Output "applied=$applied of $($files.Count)"

$fp = Join-Path $Scratch 'fingerprint.json'
& $psql @conn -d $Database -At -q -c 'set search_path = public, pg_temp' -o $fp -f (Join-Path $repo 'supabase\verification\schema_fingerprint.sql')
Push-Location $repo
try {
  node supabase\verification\check_schema_contract.mjs $fp --golden supabase\verification\schema_fingerprint.golden.json
} finally {
  Pop-Location
}
