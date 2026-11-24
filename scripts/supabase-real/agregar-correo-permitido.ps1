# Moneo · F4-05c · Agrega UN correo a la lista permitida del registro cerrado (S-7) de un proyecto real.
# Pide el correo con Read-Host (no queda en el historial de PowerShell), lo normaliza como claveCorreo
# (recorta espacios y pasa a minúsculas; la tabla además exige NFC por CHECK) y lo inserta como el
# DUEÑO (postgres) por el pooler de SESIÓN. Repetirlo con el mismo correo no hace nada.
# Nunca imprime correos: solo cuántos hay en la lista al terminar. La lista NUNCA va al repositorio.
# Requiere en la sesión: MONEO_OWNER_URL (postgres.<ref>, pooler 5432, ?sslmode=require), como verificar.ps1.
# Uso (raíz del repo):
#   powershell -ExecutionPolicy Bypass -File scripts/supabase-real/agregar-correo-permitido.ps1 -Entorno staging
param([Parameter(Mandatory)] [ValidateSet('staging', 'prod')] [string]$Entorno)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path 'scripts/supabase-real/agregar-correo-permitido.ps1')) { throw 'Córrelo desde la raíz del repositorio moneo.' }
if (-not $env:MONEO_OWNER_URL) { throw 'Falta MONEO_OWNER_URL (ver la cabecera de verificar.ps1).' }
if ($env:MONEO_OWNER_URL -notmatch 'pooler\.supabase\.com:5432/' -or $env:MONEO_OWNER_URL -notmatch 'sslmode=') {
  throw 'MONEO_OWNER_URL debe ir por el pooler de sesión (5432) con ?sslmode=require.'
}
$refs = @{ staging = 'htcpueyxruchskxqiuyk'; prod = 'uzmfnkuhuicpsesamuov' }
$usuario = ([uri]$env:MONEO_OWNER_URL).UserInfo.Split(':')[0]
if ($usuario -ne "postgres.$($refs[$Entorno])") { throw "MONEO_OWNER_URL no es del proyecto de $Entorno (usuario $usuario)." }

$correo = (Read-Host 'Correo a permitir').Trim().ToLowerInvariant().Normalize([Text.NormalizationForm]::FormC)
if ($correo -notmatch '^[^@\s]+@[^@\s]+$' -or $correo.Length -gt 254) { throw 'Eso no parece un correo.' }

$env:DB = $env:MONEO_OWNER_URL
$env:CORREO = $correo
try {
  $sql = "INSERT INTO signup_gate.allowed_email (email) VALUES (:'correo') ON CONFLICT DO NOTHING;`n" +
         "SELECT count(*) || ' correos en la lista de $Entorno' AS lista FROM signup_gate.allowed_email;"
  $sql | docker run --rm -i -e DB -e CORREO postgres:17 sh -c 'psql "$DB" -X -q -t -A -v ON_ERROR_STOP=1 -v correo="$CORREO"'
  if ($LASTEXITCODE -ne 0) { throw "psql terminó con código $LASTEXITCODE." }
} finally {
  Remove-Item Env:DB, Env:CORREO -ErrorAction SilentlyContinue
}
