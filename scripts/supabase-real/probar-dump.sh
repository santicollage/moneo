#!/usr/bin/env bash
# Moneo · F4-03c · Puntos 4, 6 y 7 de seguridad.md §6.4 contra Supabase real (solo staging).
#   4: pg_dump con el dueño respalda las tablas con RLS sin error.
#   6: pg_dump lee auth.users y auth.identities.
#   7: pg_export_snapshot + pg_dump --snapshot funcionan a través del pooler de SESIÓN (5432).
# Es el mismo camino que scripts/backup/backup.sh, sin cifrar ni subir nada: los volcados quedan en
# un directorio temporal DENTRO del contenedor y se borran al salir. Solo imprime conteos.
# Uso (PowerShell, raíz del repo; DB = postgres por el pooler de sesión):
#   docker run --rm -e DB -v "${PWD}:/w" postgres:17 bash /w/scripts/supabase-real/probar-dump.sh
set -euo pipefail
: "${DB:?Falta DB: la URL del dueño por el pooler de sesión}"
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
echo "pg_dump: $(pg_dump --version)"

# Punto 7: una sesión fija la foto y queda abierta mientras pg_dump la importa desde otra conexión.
coproc PSQL { psql "$DB" -X -q -A -t -v ON_ERROR_STOP=1; }
echo "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();" >&"${PSQL[1]}"
if ! read -r -t 30 SNAP <&"${PSQL[0]}" || [[ -z "${SNAP:-}" ]]; then
  echo "punto 7: FALLA no se pudo exportar la foto"; exit 1
fi
echo "punto 7: foto exportada (pg_export_snapshot por el pooler de sesión): ok"

con_foto=1
if pg_dump "$DB" --snapshot="$SNAP" --format=custom --schema=public --no-owner --file="$W/public.dump" 2>"$W/err"; then
  echo "punto 7: pg_dump importó la foto desde otra conexión: ok"
else
  con_foto=0
  echo "punto 7: FALLA pg_dump --snapshot: $(head -c 300 "$W/err")"
  echo "         reintento sin foto para separar el punto 4 del 7"
  pg_dump "$DB" --format=custom --schema=public --no-owner --file="$W/public.dump"
fi
tablas=$(pg_restore -l "$W/public.dump" | grep -c ' TABLE DATA public ' || true)
politicas=$(pg_restore -l "$W/public.dump" | grep -c ' POLICY public ' || true)
echo "punto 4: pg_dump de public con RLS activo: ok (${tablas} tablas con datos, ${politicas} políticas en el volcado)"

if [[ $con_foto == 1 ]]; then
  pg_dump "$DB" --snapshot="$SNAP" --format=custom --data-only \
    --table=auth.users --table=auth.identities --file="$W/auth.dump"
else
  pg_dump "$DB" --format=custom --data-only --table=auth.users --table=auth.identities --file="$W/auth.dump"
fi
usuarios=$(psql "$DB" -X -A -t -c "SELECT count(*) FROM auth.users")
echo "punto 6: pg_dump de auth.users y auth.identities: ok (${usuarios} usuarios en auth.users)"

echo "COMMIT;" >&"${PSQL[1]}"; echo "\\q" >&"${PSQL[1]}"; wait "$PSQL_PID" || true
[[ $con_foto == 1 ]] && echo "RESUMEN: ok" || { echo "RESUMEN: FALLA en el punto 7"; exit 1; }
