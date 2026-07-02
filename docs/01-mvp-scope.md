# 01 — MVP Scope

## In scope

### Industria
- Painting contractors (interior, exterior, interior+exterior) únicamente.
- El modelo de datos e industry engine deben ser genéricos (`industry_key = "painting"`), pero **no** se construirán otros motores de industria en el MVP.

### Funcionalidad
- Registro de contratista (signup) y creación de tenant/organization.
- Perfil de negocio (business profile): nombre comercial, logo, colores, licencia, dirección, contacto.
- Invitar miembros al tenant con roles (Owner, Admin, Estimator, Sales, Field Worker, Viewer).
- CRM básico: leads/opportunities, clients, client contacts.
- Proyectos con dirección de trabajo, notas, fotos.
- Mediciones específicas de painting (superficies interior/exterior, ver [07](07-estimating-engine.md)).
- Catálogo interno de materiales y mano de obra por tenant, con importación CSV.
- Motor de estimación determinista: materials, labor, prep, adjustments, taxes, markup/margin.
- Estimados con versiones (draft → ready → sent → accepted/rejected/expired).
- Opciones Good/Better/Best por estimate version.
- Generación de propuesta en PDF y portal web de cliente (sin cuenta obligatoria).
- Selección de opción, aceptación y confirmación por el cliente en el portal.
- Cobro de depósito vía Stripe Connect (Standard accounts).
- Suscripción SaaS del contratista (Stripe Billing, plan único o dos planes simples).
- Dashboard con métricas básicas (ver [00](00-product-vision.md) y [04](04-system-architecture.md)).
- Notificaciones por email transaccional (Resend/SendGrid) para envío de propuesta, aceptación, pago.
- Auditoría de acciones sensibles (audit_logs).
- 1–2 funciones de IA de bajo riesgo (generar descripción de alcance, sugerir line items faltantes) — ver [10-ai-boundaries.md](10-ai-boundaries.md) para el corte exacto.

### No funcional
- Mobile-first responsive web app (no app nativa en MVP).
- Multi-tenancy con RLS desde el día uno.
- Entornos Development, Staging, Production.
- Money en enteros (cents) — ver [07](07-estimating-engine.md).

## Out of scope (explícitamente, para el MVP)

| Fuera de alcance | Razón |
|---|---|
| Otras industrias (flooring, roofing, drywall, etc.) | El MVP valida el modelo con una sola industria antes de generalizar el plugin architecture |
| App nativa iOS/Android | Web responsive/PWA cubre el caso de uso mobile-first a menor costo; PWA se evalúa post-MVP |
| SMS (Twilio) | Añade costo de compliance (10DLC, consentimiento) sin ser crítico para el flujo de cierre; se define como fase posterior |
| Scraping de precios de proveedores (Home Depot, Sherwin-Williams, etc.) | Alta fragilidad técnica y legal; el catálogo interno + CSV cubre el MVP |
| Firma electrónica legalmente vinculante (DocuSign-grade, con certificado) | La aceptación en el MVP es un "click-to-accept" con registro de auditoría (IP, timestamp, user agent), no una firma digital certificada. Requiere validación legal futura — ver [13-risk-register.md](13-risk-register.md) |
| Reembolsos parciales automáticos / disputas complejas | Se soporta el modelo de datos, pero el flujo operativo de disputa se maneja manualmente por soporte en el MVP |
| Marketplace de subcontratistas | Fuera de la propuesta de valor inicial |
| Multi-moneda | Solo USD en el MVP; el modelo de datos reserva `currency_code` para expansión futura |
| Roles y permisos completamente personalizables por tenant | Se define una matriz de roles fija en el MVP; overrides granulares por usuario quedan para fases posteriores |
| Reportes financieros avanzados / exportación contable (QuickBooks, etc.) | Dashboard básico solamente |
| Onboarding guiado con IA / setup wizard conversacional | Onboarding basado en formularios convencionales |

## Assumptions

1. El usuario objetivo tiene un smartphone con navegador moderno y conexión a internet razonable (no se optimiza para offline-first en el MVP, aunque el diseño no debe impedirlo a futuro).
2. Los contratistas del MVP ya tienen (o pueden abrir) una cuenta de Stripe y aceptan el modelo de Stripe Connect Standard.
3. El volumen inicial (primeros 6–12 meses) es de decenas a cientos de tenants, no miles — esto habilita decisiones lean (ej. jobs en Postgres en vez de una cola dedicada).
4. Los clientes finales (homeowners) no requieren crear una cuenta para revisar/aceptar una propuesta; se autentican mediante un link con token seguro.
5. El markup/margin se gestiona por estimate/opción, no existe todavía un motor de pricing dinámico basado en IA.
6. Los pagos siempre son en USD dentro del MVP.

## Dependencies

- Cuenta de Supabase (proyecto por ambiente: dev/staging/prod).
- Cuenta de Stripe con Connect habilitado.
- Proveedor de email transaccional (Resend o SendGrid) verificado con dominio propio (SPF/DKIM) para deliverability.
- Servicio de Render para app web + worker.
- Cuenta de Anthropic (Claude API) para las funciones de IA del MVP.
- Sentry para monitoreo de errores desde el primer despliegue a staging.

## Constraints

- Presupuesto y equipo de una startup temprana: se prioriza mantenibilidad y time-to-market sobre escalabilidad prematura.
- Cumplimiento con reglas de Stripe Connect (KYC, onboarding) fuera del control directo de Scopevia.
- Regulaciones estatales sobre depósitos de contratistas (algunos estados de EE. UU. limitan el % de depósito permitido) — **requiere revisión legal**, ver [13-risk-register.md](13-risk-register.md).
- Lead-safe/RRP (EPA) para pintura en casas pre-1978 es una consideración de industria (aparece como línea de preparación), no una validación legal que el software deba imponer.

## Definition of Done (MVP)

El MVP se considera "done" cuando un painting contractor puede, sin soporte manual del equipo de Scopevia:

1. Registrarse, crear su tenant y configurar su business profile.
2. Invitar a un segundo usuario con rol Estimator.
3. Crear un lead, convertirlo en cliente y proyecto.
4. Registrar mediciones y generar un estimate con al menos 2 opciones (ej. Good/Best).
5. Ver el desglose de costo, markup y margen antes de enviar.
6. Enviar una propuesta y que el cliente la abra desde un link sin crear cuenta.
7. El cliente selecciona una opción y la acepta.
8. El cliente paga un depósito mediante Stripe Connect y el contratista ve el pago reflejado.
9. El contratista ve el proyecto reflejado en el dashboard con el estado correcto.
10. Todas las acciones sensibles (cambio de precio, envío, aceptación, pago) quedan en audit_logs.
11. Pruebas automatizadas cubren: cálculo de estimado, transición de estados, RLS de aislamiento de tenant, y verificación de webhook de Stripe.

## Open items for this deliverable

Ninguno bloqueante para continuar el diseño. Ver "Blocking decisions" al final de la respuesta para decisiones de negocio (no arquitectónicas) que sí deben resolverse antes de implementar (ej. % de depósito por defecto, planes de suscripción).
