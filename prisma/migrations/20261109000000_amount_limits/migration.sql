-- Moneo · F3-04 · Monto máximo (RN-25, RNF-SEG-09, revisión crítica de F3-02 H6) · 2026-11-09
-- Documento: docs/12-diseno-api.md §3.2 (A-3).
-- Tope: 999.999.999,99 COP = 99.999.999.999 centavos, el MISMO número que valida Zod
-- (src/contracts/shared/money.ts, MAX_AMOUNT_CENTS). Si cambia uno, cambia el otro: una prueba
-- de integración inserta MAX y MAX + 1 en las tres columnas y compara con la constante.
--
-- Por qué en la base además de Zod: un monto absurdo que entre por cualquier camino (script,
-- bug, importación de F7-01) hace fallar SUM(...)::bigint y deja el Plan ilegible.
-- Margen de desborde: 18.000 movimientos del DR × 1e11 = 1,8e15, contra 9,2e18 de BIGINT.
--
-- Migración solo de CHECK: Prisma no la genera ni la ve como deriva (igual que la parte B de la
-- inicial). No cambia permisos de moneo_app.

ALTER TABLE "movement" ADD CONSTRAINT "movement_amount_max"
  CHECK ("amount_cents" <= 99999999999);

-- Saldo inicial: puede ser 0 o negativo (tarjeta, RN-06); se acota la magnitud.
ALTER TABLE "account" ADD CONSTRAINT "account_opening_balance_bounded"
  CHECK ("opening_balance_cents" BETWEEN -99999999999 AND 99999999999);

-- Asignación: con signo (RN-04); se acota la magnitud de la celda.
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_amount_bounded"
  CHECK ("amount_cents" BETWEEN -99999999999 AND 99999999999);
