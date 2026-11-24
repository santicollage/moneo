# Moneo · F4-05c · Pide a Supabase de STAGING que envíe un correo real (SMTP y plantilla de F4-05c).
# Llama a Auth directamente con la clave PÚBLICA, como lo haría la app en E-02 o E-08:
#   -Tipo confirmacion  → POST /auth/v1/signup (el correo DEBE estar en la lista: si no, el hook da 4xx).
#                         Crea en staging un usuario SIN confirmar; su contraseña es aleatoria y no se
#                         muestra (si hace falta, se recupera con -Tipo recuperacion).
#   -Tipo recuperacion  → POST /auth/v1/recover.
# Solo staging: se niega a otra URL. Nunca imprime el correo ni la respuesta de Auth, solo el código.
# Se espera: 200 y el correo en la bandeja (revisar spam) con el enlace a {{ .SiteURL }}/confirmar#… o
# /restablecer#…. El enlace NO abre nada útil hasta F4-06 (Site URL sin app desplegada): es esperado.
# Uso (raíz del repo, con MONEO_SUPABASE_URL y MONEO_PUBLISHABLE_KEY de staging en la sesión):
#   powershell -ExecutionPolicy Bypass -File scripts/supabase-real/enviar-correo-prueba.ps1 -Tipo confirmacion
param([Parameter(Mandatory)] [ValidateSet('confirmacion', 'recuperacion')] [string]$Tipo)
$ErrorActionPreference = 'Stop'
$url = "$env:MONEO_SUPABASE_URL".TrimEnd('/')
if ($url -ne 'https://htcpueyxruchskxqiuyk.supabase.co') { throw 'MONEO_SUPABASE_URL debe ser la de staging (htcpueyxruchskxqiuyk).' }
if (-not $env:MONEO_PUBLISHABLE_KEY) { throw 'Falta MONEO_PUBLISHABLE_KEY.' }
$correo = (Read-Host 'Correo de destino').Trim().ToLowerInvariant()
if ($correo -notmatch '^[^@\s]+@[^@\s]+$') { throw 'Eso no parece un correo.' }
if ($Tipo -eq 'confirmacion') {
  $frase = ([guid]::NewGuid().ToString('N')) + ([guid]::NewGuid().ToString('N'))
  $cuerpo = @{ email = $correo; password = $frase; data = @{ display_name = 'Prueba staging' } } | ConvertTo-Json -Compress
  $ruta = 'signup'
} else {
  $cuerpo = @{ email = $correo } | ConvertTo-Json -Compress
  $ruta = 'recover'
}
try {
  $r = Invoke-WebRequest -Uri "$url/auth/v1/$ruta" -Method POST -Body $cuerpo -ContentType 'application/json' `
    -Headers @{ apikey = $env:MONEO_PUBLISHABLE_KEY } -UseBasicParsing -TimeoutSec 30
  '{0} POST /auth/v1/{1}: revisa la bandeja (y spam) en el teléfono' -f [int]$r.StatusCode, $ruta
} catch {
  $resp = $_.Exception.Response
  $codigo = if ($resp) { [int]$resp.StatusCode } else { -1 }
  $msg = if ($_.ErrorDetails) { $_.ErrorDetails.Message } else { $_.Exception.Message }
  $codigoAuth = if ($msg -match '"(error_)?code"\s*:\s*"?([a-z_0-9]+)') { $Matches[2] } else { '(sin código)' }
  "$codigo POST /auth/v1/$ruta · $codigoAuth"
  if ($codigo -eq 429) { 'Límite de correos de Supabase: espera y repite (no es un fallo del SMTP).' }
  exit 1
}
