#!/usr/bin/env bash
# Moneo · restauración de public y comparación con el manifiesto (F3-06, O-10, runbook R-5)
# BORRADOR verificado en PG16 local el 2026-11-09.
# Uso: MANIFEST_SQL=.../manifest.sql ./restore.sh ARCHIVO.tar.age CLAVE_PRIVADA URL_DESTINO
# Requisitos del destino: base nueva. Los roles nombrados en los GRANT deben existir (sin moneo_app falla
# en el primer GRANT): en el ensayo local, CREATE_MISSING_ROLES=1 los crea vacíos.
# Auth (auth.dump) no se restaura aquí: ver runbook R-4 paso 7.
set -euo pipefail
F=$1; KEY=$2; T=$3
: "${MANIFEST_SQL:?}"
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
age -d -i "$KEY" -o "$WORK/bundle.tar" "$F"
tar -C "$WORK" -xf "$WORK/bundle.tar"
# Se excluyen del índice: el CREATE del esquema public (una base nueva ya lo tiene) y los permisos
# del esquema y por defecto, que en Supabase nombran roles (anon, authenticated, service_role)
# que no existen en un Postgres local. Los GRANT de las TABLAS (a moneo_app) sí se restauran.
pg_restore -l "$WORK/public.dump" | grep -v -E ' SCHEMA - public |ACL - SCHEMA public |DEFAULT ACL ' > "$WORK/toc.list"
# Solo en el ensayo local (CREATE_MISSING_ROLES=1): los GRANT de tablas pueden nombrar roles que existen
# en Supabase y no en un Postgres local; se crean vacíos (NOLOGIN, sin privilegios) para que la
# restauración no falle. En una recuperación real a Supabase no se usa (runbook R-4).
if [[ "${CREATE_MISSING_ROLES:-0}" == "1" ]]; then
  pg_restore --use-list="$WORK/toc.list" -f - "$WORK/public.dump" \
    | grep -oE '^(GRANT|REVOKE) .* (TO|FROM) [a-z_0-9"]+;' | sed -E 's/.* (TO|FROM) "?([a-z_0-9]+)"?;/\2/' \
    | sort -u | while read -r r; do
        [[ "$r" == "public" ]] && continue
        psql "$T" -X -q -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$r') THEN CREATE ROLE \"$r\" NOLOGIN; END IF; END \$\$;"
      done
fi
pg_restore --dbname="$T" --no-owner --exit-on-error --single-transaction \
  --use-list="$WORK/toc.list" "$WORK/public.dump"
psql "$T" -X -q -A -t -f "$MANIFEST_SQL" > "$WORK/after.txt"
if diff -u "$WORK/manifest.txt" "$WORK/after.txt"; then
  echo "conteos y sumas: IGUALES"
else
  echo "DIFERENCIAS entre el manifiesto y la base restaurada"; exit 1
fi
