-- Moneo · F4-03d · Tiempos límite del rol de la app (M-4, R44, G3-H5)
-- Si una función de Vercel se corta o se congela con la transacción abierta, el bloqueo de fila del
-- espacio (M-4) se queda tomado y TODAS las escrituras de ese espacio esperan. Estos tiempos lo acotan
-- en la base, sin depender de que el cliente se porte bien:
--   lock_timeout                       una sentencia espera un bloqueo como máximo 5 s (55P03, reintentable)
--   statement_timeout                  una sentencia dura como máximo 15 s (57014)
--   idle_in_transaction_session_timeout  una transacción abierta sin hablar se mata a los 10 s (25P03)
-- Van por ROL (no por sesión): el pooler en modo transacción (6543) no deja fijarlos con SET de sesión.
-- Los mismos valores viven en src/server/shared/db/tiempos.ts; una prueba unitaria compara los dos.
-- Afecta solo a `moneo_app`: `postgres` (migraciones, respaldos) conserva los suyos.
ALTER ROLE moneo_app SET lock_timeout = '5s';
ALTER ROLE moneo_app SET statement_timeout = '15s';
ALTER ROLE moneo_app SET idle_in_transaction_session_timeout = '10s';
