# 17 — RLS Verification

## Por qué esto es su propio documento

RLS es la última línea de defensa contra fugas de datos entre tenants ([ADR-001](adr/0001-multi-tenant-database-strategy.md)). Una policy mal escrita falla en silencio (devuelve cero filas o permite de más) — no lanza un error obvio en desarrollo casual. Por eso Phase 0 exige una suite de pruebas de integración dedicada, corriendo contra Postgres real, no mocks — y por eso Phase 0 no se declaró completa hasta ejecutarla contra una base real (ver [18-phase-0-security-hardening.md](18-phase-0-security-hardening.md) y [19-phase-0-verification-evidence.md](19-phase-0-verification-evidence.md)).

## Qué cubre `tests/rls/tenant-isolation.test.ts`

La suite usa 6 usuarios de prueba (A y B, dueños de Tenant A y Tenant B respectivamente; C invitado como viewer, D invitado como admin, ambos a Tenant A; E dejado deliberadamente como invitación pendiente; F desechable solo para la prueba de creación concurrente) y está organizada en 9 grupos:

| Grupo | Qué demuestra |
|---|---|
| Invitations | Una invitación no otorga acceso hasta `accept_invitation()`; nadie puede aceptar la invitación de otro; un admin no puede forzar la aceptación; el owner puede cancelar una invitación pendiente |
| Read isolation | Aislamiento de lectura entre tenants; un Viewer activo no puede listar miembros (permiso, no solo pertenencia); no hay enumeración global de memberships/perfiles/tenants; `anon` no lee nada |
| Write isolation | Aislamiento de escritura; nadie inserta `audit_logs`/`tenant_memberships` directamente; nadie modifica roles del sistema; nadie se auto-asigna el rol owner |
| Owner protection | Un Admin no puede tocar la membresía de un Owner; otorgar el rol owner exige `roles.manage`, no solo `members.update` |
| Cross-tenant role guard | Claves de rol de sistema duplicadas son rechazadas; dos tenants pueden tener roles personalizados con la misma clave sin chocar; un rol de un tenant no puede asignarse a una membresía de otro |
| Tenant creation idempotency | Slug duplicado rechazado sin tenant huérfano; creación concurrente con el mismo slug produce exactamente un ganador, sin membership huérfana |
| Audit log integrity | `audit_logs` es append-only incluso para `service_role`; un tenant no lee logs de otro; eventos sensibles quedan registrados; el metadata no contiene secretos |
| Suspension & removal | Suspender/remover una membresía bloquea el acceso en la sesión ya existente del usuario, sin necesidad de reautenticación; un usuario suspendido no puede reactivarse a sí mismo |
| Last-owner protection under concurrency | Dos demociones concurrentes de los dos únicos owners de un tenant: exactamente una debe fallar, nunca ambas tienen éxito — la prueba directa de la corrección de concurrencia en `protect_last_owner()` |

Ver el archivo fuente para la lista exhaustiva y actualizada (40 casos `it` a la fecha de este documento).

## Cómo ejecutarla

Dos rutas igualmente válidas:

### Opción A — Supabase local (requiere Docker)

```bash
npm run db:start
```

Copia la URL y las claves que imprime a `.env.local`:

```env
SUPABASE_TEST_URL=http://127.0.0.1:54321
SUPABASE_TEST_ANON_KEY=<anon key impresa por supabase start>
SUPABASE_TEST_SERVICE_ROLE_KEY=<service_role key impresa por supabase start>
```

```bash
npm run db:reset   # asegura que las migraciones/seeds estén aplicadas
npm run test:rls
```

### Opción B — Proyecto Supabase remoto dedicado a testing

Cuando Docker no está disponible, se usa un proyecto Supabase remoto **dedicado exclusivamente a pruebas** (nunca staging/producción):

```bash
npx supabase login                              # interactivo, una vez
npx supabase link --project-ref <ref-del-proyecto-de-test>
npx supabase db push                            # aplica las 11 migraciones desde cero
```

Completa `.env.local` con la URL/anon key/service_role key de ESE proyecto bajo `SUPABASE_TEST_*` (mismos nombres que en la Opción A), luego:

```bash
npm run test:rls
```

Esta fue la ruta usada para la verificación real de Phase 0 — ver [19-phase-0-verification-evidence.md](19-phase-0-verification-evidence.md) para el proyecto lógico usado (sin exponer secretos) y los resultados.

En ambas opciones: si las tres variables `SUPABASE_TEST_*` no están presentes, la suite completa se **salta** (no falla) — así `npm test`/CI corren sin necesitar ninguna base de datos real, mientras que `npm run test:rls` es el comando explícito para la verificación completa.

## Qué NO demuestra esta suite (limitaciones conocidas)

- No prueba el aislamiento de Supabase Storage (no hay buckets/adjuntos todavía en Phase 0).
- No prueba el comportamiento exacto de expiración de sesión/refresh token — se asume el comportamiento estándar de Supabase Auth.
- No prueba concurrencia a gran escala (cientos de requests simultáneas) — solo la condición de carrera específica del último owner, con exactamente dos actores concurrentes, que es la que importa a este nivel de madurez del producto.

## Verificación manual complementaria (Supabase Studio)

1. Abre Studio → Authentication → confirma los usuarios de prueba (si quedaron, límpialos: `afterAll` ya los borra en una corrida normal).
2. SQL Editor → ejecuta `select * from pg_policies where schemaname = 'public';` y confirma que cada tabla de dominio tiene las policies documentadas en [06-security-and-rls.md](06-security-and-rls.md), `supabase/migrations/20260701120800_rls_policies.sql` y `20260701121000_security_hardening.sql`.
3. SQL Editor → `select tgname, tgrelid::regclass from pg_trigger where not tgisinternal order by 2;` para confirmar que los triggers de hardening (`trg_validate_membership_role_tenant`, `trg_protect_last_owner`, `trg_prevent_self_membership_modification`) existen.

## Checklist de RLS para cualquier tabla nueva (fases futuras)

Antes de mergear una migración que agregue una tabla con `tenant_id`:

- [ ] `alter table ... enable row level security;` en la misma migración.
- [ ] Policy de `select` explícita (nunca confiar en el default).
- [ ] Si la tabla tiene mutaciones con invariantes cross-tabla o requisito de auditoría → función `SECURITY DEFINER`, sin policy de insert/update directa.
- [ ] Si la tabla tiene mutaciones simples de un solo campo → policy de `update`/`insert` gateada por `user_has_permission()`.
- [ ] `grant` explícito solo de los verbos realmente necesarios a `authenticated` — nunca `all privileges`.
- [ ] Policy con `to authenticated` explícito — nunca omitir el `TO` (evita alcanzar `anon` por accidente).
- [ ] Si hay operaciones concurrentes que puedan violar un invariante (p. ej. "al menos uno de X"), bloquear la fila padre relevante (`FOR UPDATE`) antes de contar/verificar.
- [ ] Caso de prueba de aislamiento (y de concurrencia, si aplica) agregado a la suite de RLS.
