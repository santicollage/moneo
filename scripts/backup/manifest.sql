-- Moneo · manifiesto del respaldo (F3-06): conteo y suma de centavos por tabla de public.
-- Toda tabla nueva entra aquí en la misma migración que la crea (F5-07 agrega una prueba que
-- compara esta lista con las tablas de public, igual que el manifiesto de permisos de S-3).
SELECT 'profile', count(*), 0::numeric FROM profile UNION ALL
SELECT 'space', count(*), 0 FROM space UNION ALL
SELECT 'membership', count(*), 0 FROM membership UNION ALL
SELECT 'invitation', count(*), 0 FROM invitation UNION ALL
SELECT 'account', count(*), coalesce(sum(opening_balance_cents), 0) FROM account UNION ALL
SELECT 'category', count(*), 0 FROM category UNION ALL
SELECT 'subcategory', count(*), 0 FROM subcategory UNION ALL
SELECT 'allocation', count(*), coalesce(sum(amount_cents), 0) FROM allocation UNION ALL
SELECT 'movement', count(*), coalesce(sum(amount_cents), 0) FROM movement UNION ALL
SELECT 'audit_event', count(*), 0 FROM audit_event UNION ALL
SELECT 'rate_limit_counter', count(*), 0 FROM rate_limit_counter UNION ALL
SELECT '_prisma_migrations', count(*), 0 FROM _prisma_migrations
ORDER BY 1;
