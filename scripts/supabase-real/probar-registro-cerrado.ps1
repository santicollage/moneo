# Moneo · F4-05b · El registro directo contra Supabase está cerrado (S-7, hook Before User Created).
# Hace lo que haría cualquiera con la clave PÚBLICA: `POST /auth/v1/signup` con un correo inventado
# que no está en la lista. Espera un 4xx. Un 2xx es FALLA: el hook no está activo y se creó un
# usuario (bórralo desde el panel → Authentication → Users y activa el hook, runbook R-13).
# Sin respuesta (red) también es FALLA. No imprime el cuerpo de un 2xx.
# Uso: powershell -ExecutionPolicy Bypass -File scripts/supabase-real/probar-registro-cerrado.ps1 -Url https://<ref>.supabase.co -Clave <publishable>
param(
  [Parameter(Mandatory)] [string]$Url,
  [Parameter(Mandatory)] [string]$Clave
)
$ErrorActionPreference = 'Stop'
$Url = $Url.TrimEnd('/')
$correo = "sonda-$([guid]::NewGuid().ToString('N'))@moneo.invalid"
$frase = ([guid]::NewGuid().ToString('N')) + 'Aa1!'
$cuerpo = @{ email = $correo; password = $frase } | ConvertTo-Json -Compress
$codigo = 0; $detalle = ''
try {
  $r = Invoke-WebRequest -Uri "$Url/auth/v1/signup" -Method POST -Body $cuerpo -ContentType 'application/json' `
    -Headers @{ apikey = $Clave } -UseBasicParsing -TimeoutSec 20
  $codigo = [int]$r.StatusCode; $detalle = 'se creó un usuario (cuerpo no se muestra)'
} catch {
  $resp = $_.Exception.Response
  if ($resp) { $codigo = [int]$resp.StatusCode } else { $codigo = -1 }
  $msg = if ($_.ErrorDetails) { $_.ErrorDetails.Message } else { $_.Exception.Message }
  $detalle = ($msg -replace '\s+', ' ')
  if ($detalle.Length -gt 160) { $detalle = $detalle.Substring(0, 160) + '…' }
}
$ok = ($codigo -ge 400 -and $codigo -lt 500)
'{0,-6} {1,-4} POST /auth/v1/signup  {2}' -f ($(if ($ok) { 'ok' } else { 'FALLA' })), $codigo, $detalle
if (-not $ok) { Write-Host 'RESUMEN: FALLA (el registro directo no fue rechazado con 4xx)'; exit 1 }
Write-Host 'RESUMEN: ok (el hook rechazó el registro directo)'
