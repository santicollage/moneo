#!/usr/bin/env bash
# Prueba de humo de un despliegue (F4-06a, O-5, runbook R-1). La corre `desplegar.yml` dos veces:
# contra la URL del despliegue recién creado (protegida por Vercel: necesita HUMO_BYPASS) y, después
# de promover, contra el origen estable (APP_ORIGIN, sin protección).
#
# Uso: scripts/despliegue/humo.sh <origen>
#   APP_ORIGIN   obligatoria: va en la cabecera Origin del POST (RNF-SEG-07).
#   HUMO_BYPASS  opcional: secreto de "Protection Bypass for Automation" del proyecto de Vercel.
#
# Qué demuestra (sin datos reales y sin crear nada):
#   1. E-01 en 200 con {"status":"ok"}: la app arrancó (config válida) y llega a la base con TLS.
#   2. /entrar en 200: las páginas se sirven.
#   3. E-10 sin cookie en 401: la política de sesión responde.
#   4. E-05 con un correo inventado en 401 invalid_credentials: Origin, límite de intentos (base)
#      y Supabase Auth responden. Correo y contraseña son nuevos en cada corrida: el contador de la
#      cuenta empieza en cero y nunca coincide con un usuario real (example.com, RFC 2606).
#   5. (F4-06c, RNF-SEG-08) Cabeceras de seguridad de /entrar y de E-01: HSTS con max-age de al menos
#      un año, CSP con frame-ancestors 'none', nosniff y Referrer-Policy; en la API además
#      Cache-Control: no-store y X-Request-Id. Contra el origen estable (sin HUMO_BYPASS), también que
#      http:// redirige a https://.
set -euo pipefail

BASE="${1:?uso: humo.sh <origen>}"
BASE="${BASE%/}"
: "${APP_ORIGIN:?falta APP_ORIGIN}"

CAB=(-H "Accept: application/json")
if [ -n "${HUMO_BYPASS:-}" ]; then
  CAB+=(-H "x-vercel-protection-bypass: ${HUMO_BYPASS}")
fi

falla() { echo "::error::humo ${BASE}: $*"; exit 1; }

# Arranque en frío: E-01 tiene hasta 5 intentos (≈ 20 s) antes de dar el despliegue por roto.
estado=""
for intento in 1 2 3 4 5; do
  estado="$(curl -sS -o /tmp/humo-health.json -w '%{http_code}' "${CAB[@]}" "${BASE}/api/v1/health" || true)"
  [ "${estado}" = "200" ] && break
  echo "E-01 respondió ${estado} (intento ${intento}); espero 4 s"
  sleep 4
done
[ "${estado}" = "200" ] || falla "E-01 dio ${estado}, se esperaba 200"
[ "$(jq -r '.status' /tmp/humo-health.json)" = "ok" ] || falla "E-01 no trae status ok"
echo "ok  E-01 /api/v1/health → 200"

estado="$(curl -sS -o /dev/null -w '%{http_code}' "${CAB[@]}" "${BASE}/entrar")"
[ "${estado}" = "200" ] || falla "/entrar dio ${estado}, se esperaba 200"
echo "ok  /entrar → 200"

estado="$(curl -sS -o /dev/null -w '%{http_code}' "${CAB[@]}" "${BASE}/api/v1/me")"
[ "${estado}" = "401" ] || falla "E-10 sin cookie dio ${estado}, se esperaba 401"
echo "ok  E-10 /api/v1/me sin cookie → 401"

CORREO="humo-$(openssl rand -hex 8)@example.com"
FRASE="$(openssl rand -hex 16)"
CUERPO="$(jq -nc --arg e "${CORREO}" --arg p "${FRASE}" '{email: $e, password: $p}')"
estado="$(curl -sS -o /tmp/humo-login.json -w '%{http_code}' "${CAB[@]}" \
  -H "Content-Type: application/json" -H "Origin: ${APP_ORIGIN}" \
  -X POST --data "${CUERPO}" "${BASE}/api/v1/auth/login")"
codigo="$(jq -r '.code // empty' /tmp/humo-login.json 2>/dev/null || true)"
[ "${estado}" = "401" ] && [ "${codigo}" = "invalid_credentials" ] \
  || falla "E-05 con un correo inventado dio ${estado} ${codigo}, se esperaba 401 invalid_credentials"
echo "ok  E-05 /api/v1/auth/login inventado → 401 invalid_credentials"

# F4-06c (RNF-SEG-08): las cabeceras llegan a través de Vercel, no solo salen del código.
valor() { printf '%s\n' "$1" | grep -i "^$2:" | head -1 | cut -d: -f2- | sed 's/^ *//' || true; }

comprobar_cabeceras() {
  local ruta="$1" api="$2" h v max
  h="$(curl -sS -D - -o /dev/null "${CAB[@]}" "${BASE}${ruta}" | tr -d '\r')"

  v="$(valor "${h}" strict-transport-security)"
  max="$(printf '%s' "${v}" | sed -n 's/.*max-age=\([0-9]*\).*/\1/p')"
  [ "${max:-0}" -ge 31536000 ] || falla "${ruta}: HSTS sin max-age de al menos un año («${v}»)"

  v="$(valor "${h}" content-security-policy)"
  case "${v}" in *"frame-ancestors 'none'"*) ;; *) falla "${ruta}: la CSP no trae frame-ancestors 'none'" ;; esac

  v="$(valor "${h}" x-content-type-options)"
  [ "${v}" = "nosniff" ] || falla "${ruta}: X-Content-Type-Options no es nosniff («${v}»)"

  v="$(valor "${h}" referrer-policy)"
  [ "${v}" = "strict-origin-when-cross-origin" ] || falla "${ruta}: Referrer-Policy inesperada («${v}»)"

  if [ "${api}" = "api" ]; then
    v="$(valor "${h}" cache-control)"
    [ "${v}" = "no-store" ] || falla "${ruta}: Cache-Control no es no-store («${v}»)"
    v="$(valor "${h}" x-request-id)"
    [ -n "${v}" ] || falla "${ruta}: falta X-Request-Id"
  fi
  echo "ok  cabeceras de seguridad de ${ruta}"
}

comprobar_cabeceras "/entrar" pagina
comprobar_cabeceras "/api/v1/health" api

# La URL de cada despliegue está protegida por Vercel: la redirección HTTP → HTTPS se prueba solo
# contra el origen estable (el que se corre sin bypass).
if [ -z "${HUMO_BYPASS:-}" ] && [ "${BASE#https://}" != "${BASE}" ]; then
  salida="$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' "http://${BASE#https://}/entrar")"
  case "${salida}" in
    "301 https://"* | "302 https://"* | "307 https://"* | "308 https://"*) echo "ok  http:// redirige a https://" ;;
    *) falla "http:// no redirige a https:// (${salida})" ;;
  esac
fi

rm -f /tmp/humo-health.json /tmp/humo-login.json
echo "humo ${BASE}: todo en verde"
