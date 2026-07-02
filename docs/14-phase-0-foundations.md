# 14 — Phase 0: Foundations

Estado: **Implementado**. Este documento describe qué se construyó, qué decisiones se tomaron durante la implementación (incluyendo diferencias respecto al prompt original) y qué queda deliberadamente fuera de alcance.

## Qué incluye Phase 0

- Proyecto Next.js 16 (App Router) + TypeScript + React 19, mobile-first, sin librería de UI.
- Supabase Auth (email/password), perfiles de aplicación, multi-tenancy, roles/permisos, RLS.
- Onboarding de negocio, selector de tenant, shell protegido, página de perfil, página de miembros.
- Auditoría base (`audit_logs`) para las acciones sensibles de esta fase.
- Migraciones SQL versionadas completas, ejecutables desde una base vacía.
- Suite de pruebas: unitarias (validación, permisos) e integración de aislamiento de tenant (RLS).

## Decisiones tomadas durante la implementación

### Terminología
Se usa `tenant` consistentemente en el dominio técnico (`tenants`, `tenant_memberships`, `tenant_id`). La UI usa "business"/"Business" de cara al usuario (ver formulario de onboarding, "Set up your business").

### Modelo de membresía y roles — decisión explícita
Se evaluaron las dos opciones planteadas en el prompt:

| Opción | Decisión |
|---|---|
| ¿Una membresía, un rol? vs ¿varios roles por membresía? | **Un rol por membresía.** `tenant_memberships.role_id` es una FK directa a `roles`, sin tabla `membership_roles`. Los 6 roles son funciones de trabajo mutuamente excluyentes; nadie necesita dos a la vez en el MVP. Ver [ADR-014](adr/0002-role-and-permission-model.md). |
| ¿Roles del sistema globales o por tenant? | **Globales en Phase 0** (`is_system=true`, `tenant_id null`), sembrados una vez. El esquema ya soporta roles personalizados por tenant (`is_system=false`, `tenant_id` requerido) sin necesitar una migración futura — solo falta la UI. |

### Matriz de permisos corregida (Phase 0)

| Permission | Owner | Admin | Estimator | Sales | Field Worker | Viewer |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `tenant.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `tenant.update` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `members.view` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `members.invite` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `members.update` | ✅ | ✅* | ❌ | ❌ | ❌ | ❌ |
| `members.remove` | ✅ | ✅* | ❌ | ❌ | ❌ | ❌ |
| `roles.view` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `roles.manage` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `audit.view` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

`*` — El prompt original marcaba `members.remove` como "Limited" para Admin sin especificar el límite exacto. Se implementó como: **un Admin no puede modificar ni remover la membresía de un Owner** (verificado dentro de `update_membership()`, reutilizando el permiso `roles.manage` — que solo Owner tiene — como el gate para tocar membresías de otro Owner). Esto es una interpretación más estricta que "no se puede remover al último Owner" — ningún Admin puede tocar a NINGÚN Owner, quede uno o varios. Ver `supabase/migrations/20260701120700_auth_and_tenant_functions.sql`, función `update_membership`.

Los roles `estimator`, `sales`, `field_worker`, `viewer` solo reciben `tenant.view` porque sus permisos reales (CRM, estimating, proposals) no existen todavía como módulos — otorgar permisos especulativos sobre features inexistentes sería no verificable.

**Limitación conocida:** con esta matriz, un usuario sin `members.view` (Estimator/Sales/Field Worker/Viewer) no puede ver el nombre de ningún compañero de equipo en ningún lugar de la app todavía (la RLS de `profiles` exige `members.view` para ver perfiles ajenos). Es una postura conservadora por diseño ("sin visibilidad de colegas sin un grant explícito"), no un bug — se relajará añadiendo permisos más granulares cuando exista una razón de producto (p. ej. ver "asignado a" en un proyecto).

### Resolución del tenant activo
Cookie `httpOnly` (`scopevia_active_tenant`) como **hint únicamente**. Toda página protegida vuelve a resolver la lista autoritativa de tenants vía `get_user_tenants()` antes de confiar en el valor de la cookie. Ver [ADR-015](adr/0003-tenant-resolution-strategy.md).

### RLS: lectura por policy, escritura por función `SECURITY DEFINER`
`tenant_memberships`, `roles`, `permissions`, `role_permissions` y `audit_logs` no tienen **ningún** GRANT de INSERT/UPDATE/DELETE para `authenticated` — ni policy, ni privilegio a nivel de tabla. Toda mutación pasa por `create_tenant_with_owner()`, `update_membership()`, `invite_member_by_email()` o `log_audit_event()`. Ver [ADR-002](adr/0004-rls-and-controlled-mutation-strategy.md).

### Creación transaccional del tenant
`create_tenant_with_owner()` crea tenant + membership owner + 2 registros de auditoría en una sola función PL/pgSQL — atómico por construcción (ver [ADR-016](adr/0005-transactional-tenant-creation.md)).

### Separación de clientes Supabase
Cuatro módulos (`client.ts`, `server.ts`, `middleware.ts`, `admin.ts`) — ver [ADR-017](adr/0006-supabase-client-separation.md). `admin.ts` existe pero **no se usa en ningún flujo de Phase 0**; toda mutación usa la sesión del propio usuario contra una función `SECURITY DEFINER`, un escalamiento de privilegio más acotado y auditable que usar `service_role` desde la aplicación.

### Invitación de miembros — simplificación explícita
`invite_member_by_email()` **solo** puede añadir a alguien que **ya tiene cuenta** en Scopevia, y lo agrega directamente en estado `active` (sin flujo de token de invitación por email ni aceptación pendiente). El estado `invited` sigue existiendo en el modelo de datos (`tenant_memberships.status`) para cuando se construya ese flujo completo en una fase posterior (CRM/organización) — no se construyó una UI de "pending invites" desechable solo para Phase 0.

### Simplificación del modelo respecto al prompt original
Se eliminó `membership_roles` (tabla N:M) del esquema propuesto — ver arriba, "un rol por membresía".

## Auditoría — eventos cubiertos en Phase 0

| Evento | Origen | Transaccional con la acción |
|---|---|---|
| `tenant.created` | `create_tenant_with_owner()` | Sí |
| `tenant.updated` | Trigger `trg_audit_tenant_update` | Sí |
| `membership.role_assigned` | `create_tenant_with_owner()` / `update_membership()` | Sí |
| `membership.activated` / `.suspended` / `.removed` | `update_membership()` | Sí |
| `membership.created` | `invite_member_by_email()` | Sí |
| `profile.updated` | Trigger `trg_audit_profile_update` | Sí |
| `auth.signed_in` / `auth.signed_out` | Capa de aplicación (`src/lib/audit/log.ts`), best-effort | No — no puede serlo, Supabase Auth gestiona la sesión fuera de nuestra transacción |

`membership.role_removed` (listado en el prompt) no aplica como evento separado en Phase 0: un cambio de rol siempre es una sustitución (`membership.role_assigned` con el nuevo rol), no una remoción explícita de uno viejo — simplificación razonable dado que una membresía siempre tiene exactamente un rol.

## Funciones de base de datos

| Función | Tipo | Propósito |
|---|---|---|
| `handle_new_user()` | Trigger, `SECURITY DEFINER` | Crea `profiles` al crear `auth.users` |
| `user_is_active_tenant_member(uuid)` | Helper RLS, `SECURITY DEFINER` | ¿El usuario actual es miembro activo de este tenant? |
| `user_has_permission(uuid, text)` | Helper RLS, `SECURITY DEFINER` | ¿El usuario actual tiene este permiso en este tenant? |
| `get_user_tenants()` | `SECURITY DEFINER` | Lista autoritativa de tenants del usuario actual |
| `log_audit_event(...)` | `SECURITY DEFINER` | Única vía de escritura a `audit_logs` |
| `create_tenant_with_owner(text, text)` | `SECURITY DEFINER` | Crear tenant + membership owner + auditoría, atómico |
| `update_membership(uuid, text, text)` | `SECURITY DEFINER` | Cambiar rol/estado de una membresía |
| `invite_member_by_email(uuid, text, text)` | `SECURITY DEFINER` | Añadir un usuario existente a un tenant |
| `protect_last_owner()` | Trigger, `SECURITY DEFINER` | Bloquea degradar/suspender/remover al último owner activo |
| `prevent_self_membership_modification()` | Trigger, `SECURITY DEFINER` | Bloquea auto-modificación de rol/estado |
| `audit_tenant_update()` / `audit_profile_update()` | Trigger, `SECURITY DEFINER` | Auditoría automática de updates directos |
| `prevent_audit_log_mutation()` | Trigger | Bloquea UPDATE/DELETE en `audit_logs` |
| `set_updated_at()` | Trigger | Mantiene `updated_at` en cada tabla |

Todas las funciones `SECURITY DEFINER` fijan `search_path = public, pg_temp` explícitamente, derivan al actor exclusivamente de `auth.uid()`, y tienen `EXECUTE` revocado de `PUBLIC`/`anon`, concedido solo a `authenticated` (o, en el caso de las funciones trigger, no son invocables directamente en absoluto).

## Limitaciones conocidas de Phase 0

- Sin roles personalizados por tenant (esquema listo, UI no construida).
- Sin flujo de invitación por email con token/aceptación pendiente (ver arriba).
- Sin transferencia de ownership entre usuarios (`invite_member_by_email` explícitamente rechaza `p_role_key='owner'`).
- Sin recuperación de cuenta multi-factor, OAuth, ni magic links (diferidos según el prompt).
- Sin límite de tasa (rate limiting) implementado todavía a nivel de aplicación — ver [11 del prompt]/[06-security-and-rls.md](06-security-and-rls.md), es un ítem no bloqueante marcado para una fase posterior.
- Tipos de Supabase (`types/database.ts`) escritos a mano — deben regenerarse con `npm run db:types` en cuanto exista un proyecto Supabase real (local o remoto).
