# Moneo · F4-03d · Carga .env.staging.local en las variables de ESTA sesión de PowerShell.
# Uso (raíz del repo, con punto y espacio para que las variables queden en tu sesión):
#   . ./scripts/supabase-real/cargar-env.ps1
# Solo STAGING. Se niega a cargar un archivo que apunte a otro proyecto o que traiga variables de prod.
$ErrorActionPreference = 'Stop'
$archivo = '.env.staging.local'
if (-not (Test-Path $archivo)) { throw "Falta $archivo (cópialo de scripts/supabase-real/env.staging.local.ejemplo)." }
git check-ignore -q $archivo
if ($LASTEXITCODE -ne 0) { throw "$archivo NO está ignorado por Git. No lo cargo." }

$vars = [ordered]@{}
foreach ($linea in Get-Content $archivo) {
  if ($linea -match '^\s*(#|$)') { continue }
  if ($linea -notmatch '^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$') { throw "Línea inválida (no se muestra por si trae una contraseña)." }
  $vars[$Matches[1]] = $Matches[2].Trim('"')
}
if ($vars['MONEO_ENTORNO'] -ne 'staging') { throw 'MONEO_ENTORNO debe valer staging en este archivo.' }
$refs = foreach ($n in 'MONEO_OWNER_URL', 'MONEO_APP_URL', 'MONEO_APP_TX_URL') {
  if (-not $vars[$n]) { throw "Falta $n." }
  ([uri]$vars[$n]).UserInfo.Split(':')[0]
}
if (($refs | ForEach-Object { $_.Split('.')[1] } | Sort-Object -Unique).Count -ne 1) { throw 'Las URL no son del mismo proyecto.' }
foreach ($k in $vars.Keys) { Set-Item -Path "Env:$k" -Value $vars[$k] }
$env:DB_OWNER_URL = $vars['MONEO_OWNER_URL']
Write-Host ("Cargadas {0} variables de staging. Usuarios: {1}" -f $vars.Count, ($refs -join ', '))
