# 17 — RLS Verification

## Por qué esto es su propio documento

RLS es la última línea de defensa contra fugas de datos entre tenants ([ADR-001](adr/0001-multi-tenant-database-strategy.md)). Una policy mal escrita falla en silencio (devuelve cero filas o permite de más) — no lanza un error obvio en desarrollo casual. Por eso Phase 0 exige una suite de pruebas de integración dedicada, corriendo contra Postgres real, no mocks.

## Qué cubre `tests/rls/tenant-isolation.test.ts`

| # | Caso | Qué demuestra |
|---|---|---|
| 1 | User A no puede leer Tenant B | Aislamiento de lectura básico |
| 2 | User A no puede actualizar Tenant B | Aislamiento de escritura básico (0 filas afectadas, sin error ruidoso) |
| 3 | User A no puede listar membresías de Tenant B | Aislamiento de `tenant_memberships` |
| 4 | User A no puede asignar un rol en una membresía de Tenant B | `update_membership()` re-valida permisos independientemente de RLS |
| 5 | Simétricamente, User B no puede leer ni modificar Tenant A | La policy no favorece a "quien se registró primero" |
| 6 | Un usuario no puede cambiar su propio rol/estado | Guardia anti-auto-modificación (función + trigger) |
| 7 | El último owner activo no puede ser degradado/suspendido | Trigger `protect_last_owner`, efectivo incluso vía `service_role` directo |
| 8 | Ningún cliente puede insertar un tenant directamente | No existe policy de INSERT en `tenants` |
| 9 | Una request anónima (sin sesión) no puede leer ningún tenant | Todas las policies están `to authenticated`, nunca a `anon` |
| 10 | Un usuario sin membresía en un tenant no puede invitar miembros ahí | `user_has_permission()` deniega correctamente fuera del propio tenant |

## Cómo ejecutarla

**Requiere Docker** (para `supabase start`). Esta suite **no** se ejecutó en el entorno donde se generó Phase 0 porque ese entorno no tenía Docker disponible — está completa y lista, pero pendiente de una primera ejecución real. Ver sección "Deferred work" del reporte de entrega de Phase 0.

```bash
npm run db:start
```

Copia la URL y las claves que imprime a `.env.local` bajo estas variables (**distintas** de las de la app, para dejar explícito que son de un proyecto local desechable):

```env
SUPABASE_TEST_URL=http://127.0.0.1:54321
SUPABASE_TEST_ANON_KEY=<anon key impresa por supabase start>
SUPABASE_TEST_SERVICE_ROLE_KEY=<service_role key impresa por supabase start>
```

Luego:

```bash
npm run db:reset   # asegura que las migraciones/seeds estén aplicadas
npm run test:rls
```

Si las tres variables `SUPABASE_TEST_*` no están presentes, la suite completa se **salta** (no falla) — así `npm test` (que la excluye explícitamente) y CI pueden correr sin Docker, mientras que `npm run test:rls` es el comando explícito para la verificación completa.

## Qué NO demuestra esta suite (limitaciones conocidas)

- No prueba el aislamiento de Supabase Storage (no hay buckets/adjuntos todavía en Phase 0).
- No prueba carga/concurrencia (dos requests simultáneas de aceptación de invitación, etc.) — el `ON CONFLICT ... WHERE status='removed'` de `invite_member_by_email()` está diseñado para ser seguro ante condiciones de carrera gracias a la constraint `unique(tenant_id, user_id)`, pero no hay un test de concurrencia explícito en Phase 0.
- No prueba el comportamiento exacto de expiración de sesión/refresh token — se asume el comportamiento estándar de Supabase Auth.

## Verificación manual complementaria (Supabase Studio)

Como refuerzo visual, con `supabase start` corriendo:

1. Abre Studio (`http://127.0.0.1:54323`) → Authentication → crea dos usuarios de prueba.
2. Table Editor → `tenant_memberships`: confirma que no puedes insertar una fila manualmente como el rol `authenticated` (Studio usa el rol `postgres`/`service_role` internamente y sí podrá — la prueba real de RLS es vía la API con el JWT de cada usuario, que es exactamente lo que hace la suite automatizada arriba, no el Table Editor).
3. SQL Editor → ejecuta `select * from pg_policies where schemaname = 'public';` y confirma que cada tabla de dominio tiene las policies documentadas en [06-security-and-rls.md](06-security-and-rls.md) y en `supabase/migrations/20260701120800_rls_policies.sql`.

## Checklist de RLS para cualquier tabla nueva (fases futuras)

Antes de mergear una migración que agregue una tabla con `tenant_id`:

- [ ] `alter table ... enable row level security;` en la misma migración.
- [ ] Policy de `select` explícita (nunca confiar en el default).
- [ ] Si la tabla tiene mutaciones con invariantes cross-tabla o requisito de auditoría → función `SECURITY DEFINER`, sin policy de insert/update directa.
- [ ] Si la tabla tiene mutaciones simples de un solo campo → policy de `update`/`insert` gateada por `user_has_permission()`.
- [ ] `grant` explícito solo de los verbos realmente necesarios a `authenticated` — nunca `all privileges`.
- [ ] Policy con `to authenticated` explícito — nunca omitir el `TO` (evita alcanzar `anon` por accidente).
- [ ] Caso de prueba de aislamiento agregado a la suite de RLS.
