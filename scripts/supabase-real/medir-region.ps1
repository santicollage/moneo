# Moneo · F4-03c · Medición de región desde Bogotá (O-3, DN-7).
#
# Se corre ANTES de crear los proyectos: la región de un proyecto de Supabase no se cambia después.
# Mide el tiempo de abrir una conexión TCP (≈ una ida y vuelta de red) contra endpoints públicos de
# cada región candidata. No envía credenciales ni datos: abre y cierra sockets.
#   - DynamoDB (AWS, puerto 443): la región "pelada", sin Supabase de por medio.
#   - Pooler compartido de Supabase (puerto 5432): el mismo punto de entrada que usará la app.
# Regla de O-3: gana el menor p50; si la diferencia es < 20 ms, us-east-1 (región por defecto de Vercel).
#
# Uso (PowerShell, desde la raíz del repo):
#   powershell -ExecutionPolicy Bypass -File scripts/supabase-real/medir-region.ps1
# Córrelo en la red de todos los días. Si puedes, repítelo con el celular como punto de acceso (datos móviles).
param([int]$Intentos = 20)
$ErrorActionPreference = 'Stop'

$destinos = @(
  @{ Region = 'us-east-1'; Via = 'AWS';    Host = 'dynamodb.us-east-1.amazonaws.com';    Puerto = 443 },
  @{ Region = 'sa-east-1'; Via = 'AWS';    Host = 'dynamodb.sa-east-1.amazonaws.com';    Puerto = 443 },
  @{ Region = 'us-east-1'; Via = 'pooler'; Host = 'aws-0-us-east-1.pooler.supabase.com'; Puerto = 5432 },
  @{ Region = 'sa-east-1'; Via = 'pooler'; Host = 'aws-0-sa-east-1.pooler.supabase.com'; Puerto = 5432 }
)

function Percentil([double[]]$valores, [double]$p) {
  $orden = $valores | Sort-Object
  $i = [Math]::Ceiling($p * $orden.Count) - 1
  return [Math]::Round($orden[[Math]::Max(0, $i)], 1)
}

$filas = foreach ($d in $destinos) {
  try {
    $ip = [System.Net.Dns]::GetHostAddresses($d.Host) |
      Where-Object { $_.AddressFamily -eq 'InterNetwork' } | Select-Object -First 1
  } catch { $ip = $null }
  if (-not $ip) {
    [pscustomobject]@{ Region = $d.Region; Via = $d.Via; p50_ms = 'sin DNS'; p90_ms = ''; min_ms = ''; fallas = $Intentos }
    continue
  }
  $tiempos = @(); $fallas = 0
  for ($i = 0; $i -lt $Intentos; $i++) {
    $c = [System.Net.Sockets.TcpClient]::new()
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
      if ($c.ConnectAsync($ip, $d.Puerto).Wait(5000)) { $sw.Stop(); $tiempos += $sw.Elapsed.TotalMilliseconds }
      else { $fallas++ }
    } catch { $fallas++ } finally { $c.Dispose() }
    Start-Sleep -Milliseconds 200
  }
  if ($tiempos.Count -eq 0) {
    [pscustomobject]@{ Region = $d.Region; Via = $d.Via; p50_ms = 'sin conexión'; p90_ms = ''; min_ms = ''; fallas = $fallas }
  } else {
    [pscustomobject]@{
      Region = $d.Region; Via = $d.Via
      p50_ms = Percentil $tiempos 0.5; p90_ms = Percentil $tiempos 0.9
      min_ms = [Math]::Round(($tiempos | Measure-Object -Minimum).Minimum, 1); fallas = $fallas
    }
  }
}

Write-Host ("Medición desde este equipo, {0} intentos por destino, {1:yyyy-MM-dd HH:mm}" -f $Intentos, (Get-Date))
$filas | Format-Table -AutoSize
Write-Host 'Regla O-3: menor p50 gana; si la diferencia es < 20 ms, us-east-1. Copia esta tabla en el chat.'
