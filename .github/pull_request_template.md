## Qué cambia y por qué

<!-- Paso del plan (F4-02, F5-03…) y la decisión o regla que toca (ADR, RN, EN). -->

## Cómo se comprobó

- [ ] `pnpm lint`, `pnpm typecheck` y `pnpm test` pasan en local
- [ ] Si toca una regla financiera: la prueba se escribió antes que el código (T-13)

## Seguridad (marca lo que aplique)

- [ ] Endpoint nuevo o cambiado: pasa por `withPolicy`, está en el registro de rutas y respondí «¿quién puede hacer esto sobre este recurso?»
- [ ] Consulta nueva: filtrada por membresía y `spaceId`
- [ ] Nada de secretos, montos ni datos personales en código, logs, capturas o mensajes de commit
- [ ] Cambia `openapi.json`: revisé el diff

## Fuera de alcance

<!-- Lo que no hice a propósito (va al Parking lot). -->
