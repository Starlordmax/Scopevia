# 06 — Security Model

## Authentication

- Supabase Auth (email/password + Google OAuth) para usuarios del contratista (`users`).
- El Client Portal **no** usa Supabase Auth: el homeowner no crea cuenta. Se autentica implícitamente mediante posesión de un token opaco de un solo propósito (ver "Public proposal links" abajo).
- JWT de Supabase con expiración corta (1 hora) + refresh token; el refresh token se maneja en cookie `httpOnly`, `secure`, `sameSite=lax`, nunca en `localStorage`.

## Authorization

### Modelo
RBAC con permisos granulares, no solo nombre de rol (ver [13 del prompt]). Un rol es una colección de `permissions`; el servidor valida siempre por **permission key**, no por nombre de rol, para poder introducir overrides por tenant en el futuro sin tocar la lógica de negocio.

### Matriz de permisos (MVP)

| Permission key | Owner | Admin | Estimator | Sales | Field Worker | Viewer |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `org.manage` (billing, settings) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `org.members.manage` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `clients.view` | ✅ | ✅ | ✅ | ✅ | ✅ (solo asignados) | ✅ |
| `clients.create` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `projects.create` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `estimates.create` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `estimates.edit_cost` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `estimates.edit_margin` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `estimates.override_minimum_margin` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `proposals.send` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `payments.collect` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `payments.refund` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `stripe.configure` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `reports.financial.view` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `catalog.manage` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `ai.use` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `audit.view` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `records.delete_or_archive` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

Notas: `stripe.configure` se restringe únicamente a Owner por el riesgo financiero/legal de reconfigurar el destino de los fondos. `estimates.edit_margin` y `estimates.override_minimum_margin` son permisos distintos de `estimates.edit_cost` porque el riesgo de negocio es distinto (un Estimator puede ajustar cantidades/costos pero no debe poder saltarse el margen mínimo del negocio sin autorización).

## Tenant isolation & RLS

### Principio
Ningún query de la aplicación confía en que el `tenant_id` enviado por el cliente sea correcto. RLS es la **última línea de defensa** (defense in depth), no la única: el servidor también filtra explícitamente por el tenant activo de la sesión.

### Patrón de policy (pseudocódigo SQL, ilustrativo — no es DDL final)

```sql
-- Función auxiliar reutilizada por todas las policies
create or replace function current_tenant_ids()
returns setof uuid
language sql stable
as $$
  select tenant_id from tenant_memberships
  where user_id = auth.uid() and status = 'active'
$$;

alter table opportunities enable row level security;

create policy tenant_isolation_select on opportunities
  for select using (tenant_id in (select current_tenant_ids()));

create policy tenant_isolation_write on opportunities
  for insert with check (tenant_id in (select current_tenant_ids()));

create policy tenant_isolation_update on opportunities
  for update using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));

-- Sin policy de delete físico: las apps usan soft delete vía UPDATE
```

Cada tabla con `tenant_id` repite este patrón. Tablas sin `tenant_id` directo (ej. `estimate_line_items`, que cuelga de `estimate_options` → `estimate_versions` → `estimates`) **desnormalizan `tenant_id`** para poder aplicar la misma policy simple en vez de subqueries anidadas costosas — trade-off documentado en [ADR-001](adr/README.md).

### Acceso con permisos granulares dentro de un tenant
RLS resuelve el aislamiento **entre** tenants. La autorización **dentro** de un tenant (ej. Field Worker no debe ver márgenes) se resuelve en la capa de servidor/API, no en RLS, porque depende de contexto de negocio (columna específica, no fila completa) que RLS de Postgres no expresa bien a nivel de columna sin vistas adicionales. Se documenta como decisión explícita, no como omisión.

### Client Portal (usuario sin cuenta)
Las rutas del portal público **no** ejecutan como el usuario final (no hay `auth.uid()`). Ejecutan con `service_role` desde el servidor de Next.js, pero:

1. El servidor valida el token recibido contra `proposal_recipients.access_token_hash` (comparación por hash, nunca el token en claro almacenado).
2. Verifica `revoked_at IS NULL AND token_expires_at > now()`.
3. Filtra manualmente por `proposal_id` resuelto del token — **nunca** por un `tenant_id`/`proposal_id` recibido como parámetro de la URL sin validar contra el token.
4. Todo acceso queda registrado en `proposal_events`.

Esto evita depender de RLS para un actor que no tiene identidad en `auth.users`, y evita el anti-patrón de "confiar en el `tenant_id` que llega en la query string".

## Server-side validation (no confiar en el frontend)

El servidor re-valida en cada mutación sensible:

| Validación | Dónde se aplica |
|---|---|
| Membresía activa en el tenant | Middleware de API en cada request autenticado |
| Permiso específico para la acción | Antes de cada mutación (`estimates.edit_margin`, etc.) |
| Propiedad del recurso (`resource.tenant_id == session.tenant_id`) | En cada handler que recibe un `id` |
| Estado del documento permite la acción (ej. no editar una `estimate_version` con `locked_at`) | Antes de UPDATE, reforzado con trigger de DB |
| Recalculo de totales monetarios en servidor, nunca confiar en totales enviados por el cliente | Al guardar `estimate_line_items`/`estimate_adjustments` |
| Verificación de firma de webhook | Handler de Stripe webhook |
| Validación de tipo/tamaño de archivo | Antes de generar signed URL de subida |
| Límites de uso del plan de suscripción | Antes de crear `proposals`/enviar (si aplica límite) |

## Secret management

| Secreto | Dónde vive | Nunca debe estar en |
|---|---|---|
| Supabase `service_role` key | Variables de entorno del servidor (Next.js server / worker) | Bundle de cliente, repos, logs |
| Stripe secret key / webhook signing secret | Variables de entorno del servidor | Cliente, logs |
| Claude API key | Variables de entorno del worker (AI Gateway) | Cliente |
| Resend/SendGrid API key | Variables de entorno del worker | Cliente |
| `access_token_hash` de propuestas | Solo el hash en DB; el token en claro solo existe en la URL enviada al cliente | Logs de aplicación (redactar en middleware de logging) |

Rotación: claves de Stripe/Claude/Email rotables sin downtime (config por ambiente, ver [04](04-system-architecture.md)); rotación documentada como checklist operativo, no automatizada en el MVP.

## Signed URLs (Storage)

- Fotos de proyecto y PDFs de propuesta se sirven mediante URLs firmadas de Supabase Storage con expiración corta (ej. 15 minutos para descarga puntual desde el portal, más largas — pero renovables — para uso interno del contratista).
- Ningún bucket es público. La subida también ocurre vía signed upload URL generada por el servidor tras validar tipo/tamaño y permiso.

## Webhook security (Stripe)

1. Verificación de firma (`Stripe-Signature` header) contra el `webhook_signing_secret` del ambiente — rechazo inmediato si no coincide.
2. Idempotencia: `webhook_events.provider_event_id` unique — un evento reprocesado (reintento de Stripe) no duplica efectos.
3. Procesamiento asíncrono: el handler solo valida+encola (`background_jobs`), responde `200` rápido a Stripe, y el worker aplica el efecto de negocio — evita timeouts que causen reintentos innecesarios de Stripe.
4. Reconciliación periódica (job `stripe_reconciliation`) que compara el estado local vs. Stripe para detectar eventos perdidos.

## Rate limiting

| Superficie | Límite propuesto | Razón |
|---|---|---|
| Client Portal (por token) | ej. 60 requests/min por IP+token | Prevenir fuerza bruta sobre tokens y scraping |
| Endpoints de autenticación (login, reset password) | ej. 10 intentos/15 min por IP/email | Prevenir credential stuffing |
| API interna autenticada | Límite generoso por tenant (ej. 300 req/min) | Evitar abuso/errores de integración, no fricción normal |
| Webhooks entrantes | Sin rate limit agresivo (Stripe controla su propio retry), pero sí validación de origen | — |

Implementación concreta (Upstash, middleware de Next.js, etc.) se define en fase de implementación — **no bloqueante** para la arquitectura.

## Protección contra enumeración de links públicos

- Tokens generados con un CSPRNG de ≥128 bits, codificados en la URL — no IDs secuenciales ni UUIDs predecibles derivados de `proposal_id`.
- Respuesta idéntica (genérica "link not found or expired") tanto para token inexistente como expirado como revocado — evita diferenciar por timing/mensaje qué causó el fallo.
- Todo intento fallido de acceso se registra (sin bloquear al usuario legítimo) para detectar patrones de escaneo.

## Audit logs

Ver estructura en [05-data-model.md](05-data-model.md#audit_logs). Retención: indefinida en el MVP (volumen bajo); política de archivado se define cuando el volumen lo amerite (no bloqueante).

## Data retention & backup/recovery

| Dato | Retención | Backup |
|---|---|---|
| Datos operativos (clients, projects, estimates) | Mientras el tenant esté activo + política de gracia post-cancelación (a definir, no bloqueante) | Backups automáticos diarios de Supabase (point-in-time recovery según plan contratado) |
| Registros financieros (payments, audit_logs) | Indefinida (requisitos contables/legales — **requiere revisión con contador/abogado**) | Igual que arriba + posible export periódico a almacenamiento frío |
| Archivos (Storage) | Igual que el proyecto asociado | Replicación de Supabase Storage según plan |
| Backups de base de datos | Verificación de restauración trimestral (checklist operativo) | — |

## Sensitive data classification

| Categoría | Ejemplos | Tratamiento |
|---|---|---|
| Credenciales/secretos | Tokens de acceso, API keys | Nunca en claro en DB (hash) ni en logs |
| PII de cliente final | Nombre, email, teléfono, dirección de homeowners | Acceso restringido por tenant; no se envía a IA sin necesidad explícita (ver [10](10-ai-boundaries.md)) |
| Datos financieros | Montos, IDs de Stripe | No se almacenan números de tarjeta/CVC/cuentas bancarias — eso vive exclusivamente en Stripe |
| Datos de negocio del tenant | Costos, márgenes, catálogo | Visibles solo a roles con permiso explícito dentro del propio tenant |
| Telemetría de IA | Prompts, outputs | `input_summary` deliberadamente resumido, no el dato crudo completo, para minimizar exposición |

## Open items for this deliverable

- Proveedor específico de rate limiting (Upstash Redis vs. solución nativa de Render) — no bloqueante, se resuelve en implementación.
- Política exacta de retención post-cancelación de tenant — requiere decisión de negocio/legal, no bloqueante para el diseño de arquitectura.
