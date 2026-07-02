# 12 — Delivery Roadmap

Fases pequeñas, cada una entregable y verificable de forma independiente. Ninguna fase implica código en esta etapa de diseño — este roadmap es la guía para las fases de implementación posteriores.

## Phase 0 — Foundations

- **Objective:** dejar lista la base técnica antes de construir features.
- **Features:** ninguna visible al usuario.
- **Database changes:** setup de Supabase (3 ambientes), extensión `pgcrypto`/`uuid-ossp`, tablas `tenants`, `users`, `tenant_memberships`, `roles`, `permissions`, `role_permissions` con seed de roles fijos.
- **Backend changes:** esqueleto de Next.js + middleware de auth/tenant resolution; función `current_tenant_ids()` y patrón base de RLS.
- **Frontend changes:** shell de la app (layout mobile-first), login/signup.
- **Tests:** RLS smoke test (aislamiento básico entre 2 tenants de prueba).
- **Risks:** subestimar el esfuerzo de RLS correcto desde el inicio.
- **Acceptance criteria:** dos tenants de prueba, un usuario cada uno, verificado que ninguno ve datos del otro.
- **Dependencies:** cuentas de Supabase/Render creadas.
- **Explicitly deferred:** IA, Stripe, catálogo, cualquier feature de negocio.

## Phase 1 — Organization & Membership

- **Objective:** onboarding completo de un contratista.
- **Features:** ORG-001 a ORG-005 (ver [03](03-functional-requirements.md)).
- **Database changes:** `business_profiles`, invitaciones (tabla o extensión de `tenant_memberships` con `status=invited`).
- **Backend changes:** wizard de onboarding, invitación por email (requiere Resend/SendGrid básico).
- **Frontend changes:** business profile settings, member management.
- **Tests:** integration de invitación end-to-end; regla de "siempre ≥1 Owner activo".
- **Risks:** email deliverability desde el día uno si no se configura SPF/DKIM correctamente.
- **Acceptance criteria:** Owner crea tenant, invita Admin, Admin acepta y opera dentro del tenant.
- **Dependencies:** Phase 0.
- **Explicitly deferred:** roles custom por tenant, permisos granulares por usuario.

## Phase 2 — CRM & Projects

- **Objective:** capturar oportunidades y convertirlas en proyectos.
- **Features:** CRM-001 a CRM-006, PROJ-001 a PROJ-004.
- **Database changes:** `clients`, `client_contacts`, `opportunities`, `projects`, `project_addresses`, `project_notes`, `attachments`, `industry_definitions`, `measurement_definitions`, `project_measurements` (seed de definiciones de painting).
- **Backend changes:** endpoints CRUD con validación de permisos; subida de fotos con signed URLs.
- **Frontend changes:** formularios mobile-first de captura rápida de lead, vista de pipeline (Kanban simple por estado).
- **Tests:** transición de estados de `opportunities`; RLS sobre las nuevas tablas.
- **Risks:** el formulario de medición mal diseñado en móvil frena la adopción — requiere validación de UX temprana.
- **Acceptance criteria:** flujo completo lead → project → mediciones registradas, medible en <5 minutos en un dispositivo real.
- **Dependencies:** Phase 1.
- **Explicitly deferred:** otras industrias, geocoding de direcciones.

## Phase 3 — Catalog

- **Objective:** que cada tenant tenga su propio catálogo de precios.
- **Features:** CAT-001 a CAT-005.
- **Database changes:** `material_catalog_items`, `labor_catalog_items`, `equipment_catalog_items`, `price_sources`.
- **Backend changes:** importación CSV con validación y reporte de errores.
- **Frontend changes:** UI de gestión de catálogo, plantillas iniciales de painting precargadas (seed opcional, no obligatorio).
- **Tests:** importación CSV con filas inválidas; unicidad y RLS del catálogo por tenant.
- **Risks:** calidad de las plantillas semilla de precios de painting (dato de producto, no técnico) — ver open item en [07](07-estimating-engine.md).
- **Acceptance criteria:** un tenant nuevo puede tener un catálogo utilizable en <10 minutos (manual o vía CSV).
- **Dependencies:** Phase 0.
- **Explicitly deferred:** integración con proveedores externos, scraping.

## Phase 4 — Estimating Engine

- **Objective:** motor de cálculo determinista funcionando end-to-end para painting.
- **Features:** EST-001 a EST-010.
- **Database changes:** `estimates`, `estimate_versions`, `estimate_options`, `estimate_line_items`, `estimate_adjustments`, triggers de inmutabilidad (`locked_at`).
- **Backend changes:** implementación de fórmulas de [07-estimating-engine.md](07-estimating-engine.md), incluyendo cálculo de precio por margen objetivo, snapshots de line items.
- **Frontend changes:** editor de estimate (agregar mediciones → line items sugeridos → ajustar → ver totales/margen en tiempo real).
- **Tests:** suite exhaustiva de cálculo financiero (incluye el caso $100/30%/$142.86), tests de inmutabilidad tras "sent".
- **Risks:** el mayor riesgo técnico del MVP — errores de cálculo dañan directamente la confianza del contratista. Requiere el nivel más alto de cobertura de tests.
- **Acceptance criteria:** un estimate creado con mediciones reales produce un total verificable manualmente por un experto de painting.
- **Dependencies:** Phases 2 y 3.
- **Explicitly deferred:** override de precios por IA (no existe), multi-moneda.

## Phase 5 — Good/Better/Best & Templates

- **Objective:** generación y edición de opciones.
- **Features:** EST-006 a EST-008.
- **Database changes:** ninguna adicional relevante (ya cubierta en Phase 4); posible tabla de plantillas de opciones por tenant (`option_templates`, evaluado como *no bloqueante*, puede vivir como JSON en `business_profiles` en una primera iteración).
- **Backend changes:** lógica de duplicar/reordenar opciones.
- **Frontend changes:** UI de comparación lado a lado de Good/Better/Best para el contratista (previa al envío).
- **Tests:** duplicar opción preserva line items correctamente; solo una opción `is_recommended`.
- **Risks:** UX de comparación compleja en pantallas pequeñas — requiere diseño cuidadoso.
- **Acceptance criteria:** un estimator genera 3 opciones distintas (no solo % distinto) en menos de 5 minutos partiendo de una plantilla.
- **Dependencies:** Phase 4.
- **Explicitly deferred:** sugerencia de diferenciación vía IA (función 4 del [10](10-ai-boundaries.md), post-MVP).

## Phase 6 — Proposals & Client Portal

- **Objective:** el cliente puede ver, comparar y aceptar una propuesta sin cuenta.
- **Features:** PROP-001 a PROP-009.
- **Database changes:** `proposals`, `proposal_recipients`, `proposal_events`, `proposal_acceptances`.
- **Backend changes:** generación de PDF (Playwright, worker), generación/validación de tokens seguros, rutas públicas del portal con `service_role` controlado.
- **Frontend changes:** vista del Client Portal (comparación de opciones, aceptación, descarga de PDF).
- **Tests:** seguridad de tokens (expiración, revocación, no enumeración), inmutabilidad tras envío, eventos registrados correctamente.
- **Risks:** este módulo concentra el mayor riesgo de seguridad orientado a un actor externo no autenticado — requiere revisión de seguridad dedicada antes de salir a producción.
- **Acceptance criteria:** un cliente externo (probado con un dispositivo real, sin cuenta) completa el flujo ver → comparar → seleccionar → aceptar.
- **Dependencies:** Phase 5.
- **Explicitly deferred:** firma electrónica certificada, portal con cuenta opcional para el cliente.

## Phase 7 — Payments (Stripe Connect)

- **Objective:** cobrar depósitos y gestionar la suscripción del contratista.
- **Features:** PAY-001 a PAY-006, BILL-001, BILL-002.
- **Database changes:** `payments`, `payment_events`, `stripe_connected_accounts`, `subscription_plans`, `subscriptions`, `usage_records`, `webhook_events`.
- **Backend changes:** onboarding de Connect, creación de Payment Intents, handler de webhooks idempotente, Stripe Billing para suscripción.
- **Frontend changes:** UI de conexión de Stripe, Payment Element en el portal, pantalla de estado de pago.
- **Tests:** idempotencia de webhooks, flujo de pago fallido, flujo de reembolso.
- **Risks:** el de mayor riesgo financiero/legal del MVP — requiere ambiente de test de Stripe exhaustivo antes de habilitar `live mode`.
- **Acceptance criteria:** un pago de prueba en modo test completa el ciclo cobro → webhook → reflejo en dashboard, de forma idempotente ante reintentos simulados.
- **Dependencies:** Phase 6.
- **Explicitly deferred:** disputas con evidencia gestionada dentro de Scopevia, pagos parciales/balance post-depósito.

## Phase 8 — Dashboard, Notifications, AI (P1) & Audit UI

- **Objective:** cerrar el ciclo de valor con visibilidad y asistencia.
- **Features:** DASH-001 a DASH-003, NOTIF-001 a NOTIF-002, AI-001 a AI-003, AUDIT-002.
- **Database changes:** `notifications`, `notification_preferences`, `ai_recommendations`.
- **Backend changes:** AI Gateway (funciones 1 y 3 de [10](10-ai-boundaries.md)), agregaciones de dashboard.
- **Frontend changes:** dashboard con métricas, UI de auditoría por entidad.
- **Tests:** fórmulas de dashboard verificadas contra fixtures conocidos; degradación con gracia si Claude API falla.
- **Risks:** costo de IA no controlado si no se implementan límites desde el inicio.
- **Acceptance criteria:** dashboard refleja correctamente un set de datos de prueba con valores calculados a mano.
- **Dependencies:** Phases 4, 6, 7.
- **Explicitly deferred:** funciones de IA 2, 4, 5, 6, 7.

## Phase 9 — Hardening & Launch Readiness

- **Objective:** preparar el sistema para usuarios reales.
- **Features:** ninguna nueva; foco en calidad y seguridad.
- **Database changes:** revisión final de índices, políticas RLS, constraints de integridad.
- **Backend changes:** rate limiting, revisión de logs (redacción de secretos), reconciliación de Stripe automatizada.
- **Frontend changes:** pulido de accesibilidad P1, revisión responsive final en dispositivos reales.
- **Tests:** suite E2E completa de journeys P0, security review dedicado (ver [06](06-security-and-rls.md)), prueba de restauración de backup.
- **Risks:** ver [13-risk-register.md](13-risk-register.md) completo.
- **Acceptance criteria:** checklist de "Definition of Done" del MVP ([01](01-mvp-scope.md)) cumplido al 100%.
- **Dependencies:** todas las fases anteriores.
- **Explicitly deferred:** todo lo marcado "Out of scope" en [01-mvp-scope.md](01-mvp-scope.md).

## Open items for this deliverable

- Estimación de duración por fase (semanas/sprints) no incluida deliberadamente — depende del tamaño del equipo de implementación, que aún no se ha definido.
