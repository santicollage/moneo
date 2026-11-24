#!/bin/sh
# Moneo · F4-05c · Corre un .sql de SOLO LECTURA contra $DB y falla de verdad:
#   - si psql termina con error (p. ej. no resuelve el nombre del pooler), y
#   - si en la salida no aparece la línea RESUMEN en ok, o aparece con FALLA.
# Antes, verificar.ps1 hacía esto con `psql | tee && ! grep`, que (1) tomaba el código de salida de tee y
# (2) llevaba comillas dobles dentro del comando: Windows PowerShell 5.1 las pasa mal a `docker run … sh -c`
# y el grep nunca llegaba a leer el archivo. Por eso el comando de verificar.ps1 no lleva comillas.
# Uso (dentro del contenedor, con DB en el entorno): sh correr-sql.sh <archivo.sql> catalogo|hook
sql=$1
tipo=$2
salida=/tmp/salida-sql.txt
psql "$DB" -X -v ON_ERROR_STOP=1 -f "$sql" > "$salida" 2>&1
rc=$?
cat "$salida"
if [ "$rc" -ne 0 ]; then
  echo "FALLA: psql terminó con código $rc"
  exit 1
fi
case "$tipo" in
  catalogo) ok='^ RESUMEN .*| ok'; mal='^ RESUMEN .*FALLA' ;;
  hook) ok='RESUMEN ok'; mal='RESUMEN FALLA' ;;
  *) echo "FALLA: tipo desconocido ($tipo)"; exit 2 ;;
esac
if ! grep -q "$ok" "$salida"; then
  echo "FALLA: no aparece la línea RESUMEN en ok"
  exit 1
fi
if grep -q "$mal" "$salida"; then
  echo "FALLA: el resumen marca FALLA"
  exit 1
fi
exit 0
