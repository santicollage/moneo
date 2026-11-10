#!/usr/bin/env bash
# Moneo · respaldo cifrado de una sola foto (F3-06, O-9) · BORRADOR verificado en PG16 local el 2026-11-09.
# Insumo de F5-07: el workflow de GitHub Actions llama a este script y sube el resultado a B2.
# Uso: DB_URL=... OUT_DIR=... AGE_RECIPIENT=age1... MANIFEST_SQL=.../manifest.sql [INCLUDE_AUTH=1] ./backup.sh
#   DB_URL: el DUEÑO de las tablas (postgres en Supabase) por el pooler de SESIÓN (5432).
#           Con un rol sujeto a RLS, pg_dump falla (verificado).
# Regla: el repo es público y los logs de Actions también. Este script solo imprime el nombre del archivo.
set -euo pipefail
: "${DB_URL:?}" "${OUT_DIR:?}" "${AGE_RECIPIENT:?}" "${MANIFEST_SQL:?}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT

# 1) Una sesión fija la foto (REPEATABLE READ + snapshot exportado) y queda abierta hasta el final.
coproc PSQL { psql "$DB_URL" -X -q -A -t -v ON_ERROR_STOP=1; }
echo "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();" >&"${PSQL[1]}"
read -r SNAP <&"${PSQL[0]}"

# 2) Manifiesto (conteo y suma de centavos por tabla) en la MISMA foto.
{ echo "\\o $WORK/manifest.txt"; echo "\\i $MANIFEST_SQL"; echo "\\o"; echo "SELECT 'ok';"; } >&"${PSQL[1]}"
read -r _ <&"${PSQL[0]}"

# 3) public completo (schema + datos, incluida _prisma_migrations) con la misma foto.
pg_dump "$DB_URL" --snapshot="$SNAP" --format=custom --schema=public --no-owner --file="$WORK/public.dump"

# 4) Datos de Auth (M-2: profile.id = id del usuario de Auth). SIN VERIFICAR: F4-03 comprueba que
#    postgres puede leer estas tablas en Supabase; F5-07 ensaya su restauración (R51).
if [[ "${INCLUDE_AUTH:-0}" == "1" ]]; then
  pg_dump "$DB_URL" --snapshot="$SNAP" --format=custom --data-only \
    --table=auth.users --table=auth.identities --file="$WORK/auth.dump"
fi

echo "COMMIT;" >&"${PSQL[1]}"; echo "\\q" >&"${PSQL[1]}"; wait "$PSQL_PID" || true

# 5) Empaquetar y cifrar con la clave PÚBLICA. Nada en claro sale de $WORK.
tar -C "$WORK" -cf "$WORK/bundle.tar" $(cd "$WORK" && ls *.dump manifest.txt)
age -r "$AGE_RECIPIENT" -o "$OUT_DIR/moneo-$STAMP.tar.age" "$WORK/bundle.tar"
echo "respaldo ok: moneo-$STAMP.tar.age"
