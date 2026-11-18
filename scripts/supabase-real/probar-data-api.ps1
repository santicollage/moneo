# Moneo · F4-03c · Data API apagada (S-2, punto 3 de seguridad.md §6.4, RNF-SEG-10).
# Llama a la Data API con la clave PÚBLICA (la que cualquiera puede ver) y espera error en todo.
# Un 2xx es FALLA aunque venga vacío: significa que la Data API está encendida. Sin respuesta
# (DNS o red) también es FALLA: no prueba nada. Nunca imprime el
# cuerpo de una respuesta 2xx (si trajera filas sería un incidente, seguridad.md §12): solo su tamaño.
# Uso: powershell -ExecutionPolicy Bypass -File scripts/supabase-real/probar-data-api.ps1 -Url https://<ref>.supabase.co -Clave <publishable> [-Clave <anon legacy>]
param(
  [Parameter(Mandatory)] [string]$Url,
  [Parameter(Mandatory)] [string[]]$Clave
)
$ErrorActionPreference = 'Stop'
$Url = $Url.TrimEnd('/')
$tablas = 'profile', 'space', 'membership', 'invitation', 'account', 'category', 'subcategory',
          'allocation', 'movement', 'audit_event', 'rate_limit_counter', '_prisma_migrations'
$rutas = @('/rest/v1/') + ($tablas | ForEach-Object { "/rest/v1/$($_)?select=*&limit=1" })
$fallas = 0

foreach ($k in $Clave) {
  $etiqueta = if ($k.StartsWith('sb_publishable_')) { 'publishable' } else { 'anon (legacy)' }
  $cab = @{ apikey = $k; Authorization = "Bearer $k" }
  $pruebas = @($rutas | ForEach-Object { @{ Metodo = 'GET'; Ruta = $_; Cuerpo = $null } })
  $pruebas += @{ Metodo = 'POST'; Ruta = '/graphql/v1'; Cuerpo = '{"query":"{ __typename }"}' }
  foreach ($p in $pruebas) {
    $codigo = 0; $detalle = ''
    try {
      $parametros = @{ Uri = "$Url$($p.Ruta)"; Method = $p.Metodo; Headers = $cab; UseBasicParsing = $true; TimeoutSec = 20 }
      if ($p.Cuerpo) { $parametros.Body = $p.Cuerpo; $parametros.ContentType = 'application/json' }
      $r = Invoke-WebRequest @parametros
      $codigo = [int]$r.StatusCode; $detalle = "cuerpo de $($r.Content.Length) caracteres (no se muestra)"
    } catch {
      $resp = $_.Exception.Response
      if ($resp) { $codigo = [int]$resp.StatusCode } else { $codigo = -1 }
      $msg = if ($_.ErrorDetails) { $_.ErrorDetails.Message } else { $_.Exception.Message }
      $detalle = ($msg -replace '\s+', ' ')
      if ($detalle.Length -gt 140) { $detalle = $detalle.Substring(0, 140) + '…' }
    }
    # Sin respuesta (DNS, red) no prueba nada: cuenta como FALLA y hay que repetir.
    $ok = ($codigo -ge 300 -or ($codigo -ge 100 -and $codigo -lt 200))
    if (-not $ok) { $fallas++ }
    '{0,-6} {1,-13} {2,-4} {3,-48} {4}' -f ($(if ($ok) { 'ok' } else { 'FALLA' })), $etiqueta, $codigo, "$($p.Metodo) $($p.Ruta)", $detalle
  }
}
if ($fallas -gt 0) { Write-Host "RESUMEN: FALLA ($fallas respuestas 2xx o sin respuesta: revisar)"; exit 1 }
Write-Host 'RESUMEN: ok (ninguna respuesta 2xx)'
