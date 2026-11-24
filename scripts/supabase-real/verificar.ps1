# Moneo · F4-03c · Corre todas las verificaciones contra un proyecto real de Supabase.
#
# Variables de entorno (SOLO en esta sesión de PowerShell; nunca en .env ni en un archivo):
#   MONEO_OWNER_URL        postgres.<ref>  por el pooler de SESIÓN (5432), con ?sslmode=require
#   MONEO_APP_URL          moneo_app.<ref> por el pooler de SESIÓN (5432), con ?sslmode=require
#   MONEO_APP_TX_URL       moneo_app.<ref> por el pooler de TRANSACCIONES (6543), con ?sslmode=require
#   MONEO_SUPABASE_URL     https://<ref>.supabase.co
#   MONEO_PUBLISHABLE_KEY  clave pública (sb_publishable_…); MONEO_ANON_KEY opcional (legacy)
# Uso (raíz del repo):
#   powershell -ExecutionPolicy Bypass -File scripts/supabase-real/verificar.ps1 -Entorno staging
#   powershell -ExecutionPolicy Bypass -File scripts/supabase-real/verificar.ps1 -Entorno prod
# En prod no corre probar-dump.sh (puntos 4, 6 y 7 dependen de la plataforma; F4-03c los prueba en staging).
# Nada de lo que imprime contiene datos ni contraseñas. Copia la salida completa en el chat.
param([Parameter(Mandatory)] [ValidateSet('staging', 'prod')] [string]$Entorno)
$ErrorActionPreference = 'Stop'
$aqui = 'scripts/supabase-real'
if (-not (Test-Path "$aqui/verificar.ps1")) { throw 'Córrelo desde la raíz del repositorio moneo.' }

$requeridas = 'MONEO_OWNER_URL', 'MONEO_APP_URL', 'MONEO_APP_TX_URL', 'MONEO_SUPABASE_URL', 'MONEO_PUBLISHABLE_KEY'
foreach ($n in $requeridas) {
  if (-not [Environment]::GetEnvironmentVariable($n)) { throw "Falta la variable $n (ver la cabecera de este script)." }
}
foreach ($n in 'MONEO_OWNER_URL', 'MONEO_APP_URL', 'MONEO_APP_TX_URL') {
  $v = [Environment]::GetEnvironmentVariable($n)
  if ($v -notmatch 'pooler\.supabase\.com') { throw "$n no apunta al pooler (*.pooler.supabase.com)." }
  if ($v -notmatch 'sslmode=') { throw "$n no lleva ?sslmode=require (TLS obligatorio, seguridad.md §8)." }
}
if ($env:MONEO_APP_TX_URL -notmatch ':6543/') { throw 'MONEO_APP_TX_URL debe usar el puerto 6543 (pooler de transacciones).' }
if ($env:MONEO_APP_URL -notmatch ':5432/' -or $env:MONEO_OWNER_URL -notmatch ':5432/') {
  throw 'MONEO_OWNER_URL y MONEO_APP_URL deben usar el puerto 5432 (pooler de sesión).'
}

$resultados = [ordered]@{}
function Paso([string]$nombre, [scriptblock]$accion) {
  Write-Host "`n=== $nombre ===" -ForegroundColor Cyan
  $global:LASTEXITCODE = 0   # F4-05c: un script de PowerShell que termina bien no lo pone a 0 y heredaba el del paso anterior
  & $accion
  $resultados[$nombre] = if ($LASTEXITCODE -eq 0) { 'ok' } else { "FALLA (código $LASTEXITCODE)" }
}
function EnDocker([string]$url, [string]$comando) {
  $env:DB = $url
  try { docker run --rm -e DB -v "${PWD}:/w" postgres:17 sh -c $comando } finally { Remove-Item Env:DB -ErrorAction SilentlyContinue }
}

Write-Host ("Moneo · F4-03c · verificación de {0} · {1:yyyy-MM-dd HH:mm}" -f $Entorno, (Get-Date))

Paso 'Catálogo como dueño (0, 1, H2, RLS, S-2, 6, MIG)' {
  # F4-05c: correr-sql.sh exige el código de salida de psql y la línea RESUMEN en ok (ver su cabecera).
  EnDocker $env:MONEO_OWNER_URL 'sh /w/scripts/supabase-real/correr-sql.sh /w/scripts/supabase-real/catalogo-dueno.sql catalogo'
}
Paso 'Manifiesto de permisos (S-3, heredado 3)' {
  $salida = "salida/permisos-$Entorno.json"
  EnDocker $env:MONEO_OWNER_URL "psql `"`$DB`" -X -q -v ON_ERROR_STOP=1 -f /w/$aqui/manifiesto-real.sql -o /w/$aqui/$salida"
  if ($LASTEXITCODE -eq 0) { node "$aqui/comparar-manifiesto.mjs" "$aqui/$salida" }
}
Paso 'Comportamiento de moneo_app por el pooler de SESIÓN 5432 (1, 2, S-1)' {
  EnDocker $env:MONEO_APP_URL 'psql "$DB" -X -v ON_ERROR_STOP=1 -f /w/scripts/supabase-real/comportamiento-app.sql'
}
Paso 'Comportamiento de moneo_app por el pooler de TRANSACCIONES 6543 (2)' {
  EnDocker $env:MONEO_APP_TX_URL 'psql "$DB" -X -v ON_ERROR_STOP=1 -f /w/scripts/supabase-real/comportamiento-app.sql'
}
Paso 'Data API con la clave pública (3, S-2)' {
  $claves = @($env:MONEO_PUBLISHABLE_KEY) + @($env:MONEO_ANON_KEY | Where-Object { $_ })
  & "$aqui/probar-data-api.ps1" -Url $env:MONEO_SUPABASE_URL -Clave $claves
}
Paso 'Hook de registro en la base (S-7, F4-05b)' {
  EnDocker $env:MONEO_OWNER_URL 'sh /w/scripts/supabase-real/correr-sql.sh /w/scripts/supabase-real/hook-registro.sql hook'
}
Paso 'Registro directo rechazado por el hook (S-7, F4-05b)' {
  & "$aqui/probar-registro-cerrado.ps1" -Url $env:MONEO_SUPABASE_URL -Clave $env:MONEO_PUBLISHABLE_KEY
}
if ($Entorno -eq 'staging') {
  Paso 'pg_dump, foto y Auth por el pooler de sesión (4, 6, 7)' {
    EnDocker $env:MONEO_OWNER_URL 'bash /w/scripts/supabase-real/probar-dump.sh'
  }
}

Write-Host "`n=== Resumen ($Entorno) ===" -ForegroundColor Cyan
$resultados.GetEnumerator() | ForEach-Object { '{0,-8} {1}' -f $_.Value.Split(' ')[0], $_.Key }
if ($resultados.Values | Where-Object { $_ -ne 'ok' }) { exit 1 }
