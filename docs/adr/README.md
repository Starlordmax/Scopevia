# Architecture Decision Records — Índice

ADRs marcadas **Accepted** tienen su archivo completo (`NNNN-titulo-kebab-case.md`) escrito e implementado en Phase 0. Las marcadas **Proposed** siguen siendo decisiones de diseño preliminares de fases futuras (formalizar cuando esa fase comience). Formato de ADR completa: Context, Decision, Consequences, Status, Date.

| # | Título | Status | Decisión resumida | Documento relacionado |
|---|---|---|---|---|
| ADR-001 | [Multi-tenant database strategy](0001-multi-tenant-database-strategy.md) | **Accepted** (Phase 0) | Shared database, shared schema, aislamiento por `tenant_id` + RLS. Se descarta schema-per-tenant y database-per-tenant por costo operativo a la escala del MVP | [05](../05-data-model.md), [06](../06-security-and-rls.md) |
| ADR-002 | [RLS: lectura por policy, escritura por función `SECURITY DEFINER`](0004-rls-and-controlled-mutation-strategy.md) | **Accepted** (Phase 0) | RLS habilitado en toda tabla con `tenant_id`; mutaciones con invariantes cross-tabla (crear tenant+owner, cambiar rol) pasan exclusivamente por funciones `SECURITY DEFINER`, sin policy ni grant de INSERT/UPDATE directo para `authenticated` | [06](../06-security-and-rls.md), [14](../14-phase-0-foundations.md) |
| ADR-003 | Money storage como enteros en cents | Proposed | Todo valor monetario en `bigint` cents + `currency_code`; porcentajes en `numeric(7,4)` como fracción. Nunca floats | [07](../07-estimating-engine.md) |
| ADR-004 | Estimate & Proposal versioning inmutable | Proposed | Versiones append-only; `locked_at` congela una `estimate_version` al generarse una propuesta; revisiones crean nuevas versiones, nunca sobrescriben | [05](../05-data-model.md), [08](../08-state-machines.md) |
| ADR-005 | Public proposal links con token opaco, no JWT de usuario | Proposed | El Client Portal se autentica vía token CSPRNG hasheado en DB, validado por rutas de servidor con `service_role`, no vía `auth.uid()` | [06](../06-security-and-rls.md) |
| ADR-006 | Background job processing en Postgres (no Redis/cola dedicada) en el MVP | Proposed | Tabla `background_jobs` + polling con `SKIP LOCKED`; se migra a una cola dedicada si el volumen lo justifica | [04](../04-system-architecture.md) |
| ADR-007 | Stripe Connect Standard (no Custom) para pagos del cliente final | Proposed | Onboarding hospedado por Stripe; Scopevia no asume compliance de KYC/disputas | [09](../09-payments-and-stripe.md) |
| ADR-008 | PDF generation vía Playwright/Chromium en worker separado | Proposed | Reutiliza el mismo HTML/CSS del portal para consistencia visual; aislado del proceso web principal | [04](../04-system-architecture.md) |
| ADR-009 | AI provider abstraction (AI Gateway) | Proposed | Toda llamada a modelos de IA pasa por una capa propia; el dominio nunca invoca el SDK de Claude directamente | [10](../10-ai-boundaries.md) |
| ADR-010 | Industry plugin architecture data-driven | Proposed | `industry_definitions` + `measurement_definitions` configuran el motor por industria; el core de cálculo se resuelve por estrategia registrada, no por condicionales `if industry === X` dispersos | [05](../05-data-model.md), [07](../07-estimating-engine.md) |
| ADR-011 | Fusión de Lead y Opportunity en una sola entidad | Proposed | `opportunities` cubre todo el pipeline desde `new` hasta `won`/`lost`; se descarta una tabla `leads` separada del modelo preliminar | [05](../05-data-model.md), [08](../08-state-machines.md) |
| ADR-012 | Eliminación de `price_snapshots` y `estimate_taxes` como tablas independientes | Proposed | El snapshot vive embebido en `estimate_line_items`; los impuestos se modelan como un `type` más de `estimate_adjustments` | [05](../05-data-model.md) |
| ADR-013 | Autorización a nivel de columna (no solo de fila) resuelta en la capa de aplicación | Proposed | RLS resuelve aislamiento entre tenants; visibilidad de campos sensibles (ej. márgenes para Field Worker) se resuelve en la API, no en RLS | [06](../06-security-and-rls.md) |
| ADR-014 | [Role and permission model](0002-role-and-permission-model.md) | **Accepted** (Phase 0) | Una membresía tiene exactamente un rol (`tenant_memberships.role_id`, sin tabla `membership_roles`); roles del sistema son globales (`tenant_id null`); toda autorización se decide por `permission key`, nunca por nombre de rol | [14](../14-phase-0-foundations.md) |
| ADR-015 | [Active tenant resolution](0003-tenant-resolution-strategy.md) | **Accepted** (Phase 0) | Cookie httpOnly como *hint* únicamente; toda resolución re-valida contra `get_user_tenants()` server-side antes de conceder acceso | [14](../14-phase-0-foundations.md) |
| ADR-016 | [Transactional tenant creation](0005-transactional-tenant-creation.md) | **Accepted** (Phase 0) | `create_tenant_with_owner()` crea tenant + membership owner + audit trail en una sola transacción PL/pgSQL; imposible que exista un tenant sin owner | [14](../14-phase-0-foundations.md) |
| ADR-017 | [Supabase client separation](0006-supabase-client-separation.md) | **Accepted** (Phase 0) | Cuatro clientes de Supabase distintos (`client.ts`, `server.ts`, `middleware.ts`, `admin.ts`) con `import "server-only"` en todo módulo que no debe llegar al navegador | [14](../14-phase-0-foundations.md) |

## Cómo usar este índice

Cuando una fase del roadmap ([12-delivery-roadmap.md](../12-delivery-roadmap.md)) toque el área de una ADR marcada `Proposed` aquí, se debe:

1. Crear el archivo completo `docs/adr/00XX-titulo.md` con el detalle formal.
2. Cambiar el status en este índice a `Accepted` (o `Superseded`/`Rejected` si se decide diferente durante la implementación).
3. Enlazar la ADR completa desde este índice, como ya se hizo para ADR-001, ADR-002 y ADR-014 a ADR-017 en Phase 0.
