-- Moneo · F4-03d · Comprueba (solo lectura, como dueño) que moneo_app tiene EXACTAMENTE los tres tiempos
-- límite de la migración 20261118000000_role_timeouts. Los mismos valores viven en
-- src/server/shared/db/tiempos.ts; tests/integration/db/tiempos-limite.test.ts los compara en local.
-- Uso (runbook R-12):  psql "$DB" -X -v ON_ERROR_STOP=1 -f scripts/supabase-real/tiempos-rol.sql
\pset pager off
SELECT unnest(setconfig) AS ajuste
FROM pg_db_role_setting
WHERE setrole = 'moneo_app'::regrole AND setdatabase = 0
ORDER BY 1;

SELECT CASE
  WHEN (
    SELECT array_agg(x ORDER BY x)
    FROM pg_db_role_setting s, unnest(s.setconfig) AS x
    WHERE s.setrole = 'moneo_app'::regrole AND s.setdatabase = 0
  ) = ARRAY['idle_in_transaction_session_timeout=10s', 'lock_timeout=5s', 'statement_timeout=15s']
  THEN 'tiempos del rol: ok'
  ELSE 'tiempos del rol: FALLA'
END AS resumen;
