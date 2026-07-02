# 02 — Personas and Journeys

## Personas

### 1. Owner-Operator — "Mike"
- Dueño de una empresa de pintura con 3–8 empleados.
- Hace ventas, estima y a veces pinta.
- Usa el teléfono el 80% del tiempo; la laptop solo de noche para "papeleo".
- Objetivo: cerrar más trabajos sin pasar horas armando propuestas.
- Frustración: perder el hilo de a quién le debe seguimiento.
- Rol en Scopevia: **Owner**.

### 2. Office Estimator/Admin — "Dana"
- Empleada de oficina o cónyuge del dueño que administra CRM, arma estimados detallados y hace seguimiento de cobros.
- Usa laptop y tablet.
- Objetivo: estandarizar la calidad de las propuestas y no perder ningún pago pendiente.
- Rol en Scopevia: **Admin** o **Estimator**.

### 3. Field Worker — "Chris"
- Pintor de campo, no vende ni cotiza.
- Necesita ver la dirección del proyecto, notas de acceso, fotos del antes, y checklist de preparación.
- No debe ver precios, márgenes ni información financiera del cliente si el tenant así lo configura.
- Rol en Scopevia: **Field Worker**.

### 4. Homeowner Client — "Sarah"
- Cliente final que recibió una propuesta.
- No quiere crear una cuenta ni instalar nada.
- Quiere comparar opciones, entender qué incluye cada una, y pagar el depósito con tarjeta desde el celular.
- No es un usuario de Scopevia (no tiene membership); interactúa solo a través del **Client Portal** vía link seguro.

### 5. Commercial Property Manager (persona secundaria, futuro)
- Administra múltiples propiedades, necesita comparar varias propuestas y aprobar con proceso interno.
- No se diseña a fondo en el MVP, pero el modelo de `clients`/`client_contacts` no debe impedir esta expansión (múltiples contactos, múltiples proyectos por client).

## Jobs to be done (resumen, ver también [00](00-product-vision.md))

| Persona | Job principal |
|---|---|
| Mike (Owner) | Cerrar más negocio sin fricción administrativa |
| Dana (Admin/Estimator) | Producir estimados y propuestas consistentes y profesionales |
| Chris (Field Worker) | Saber qué hacer y dónde, sin distracción de datos que no necesita |
| Sarah (Client) | Decidir con confianza y pagar sin fricción |

---

## User Journeys

Cada journey incluye: actor, disparador, pasos, sistema/estado resultante, casos límite.

### 1. Contractor onboarding

| Paso | Actor | Acción | Resultado |
|---|---|---|---|
| 1 | Mike | Se registra con email/password o proveedor OAuth (Google) | `users` creado vía Supabase Auth |
| 2 | Mike | Confirma email | `users.email_confirmed_at` set |
| 3 | Sistema | Crea el tenant automáticamente al finalizar el wizard de setup | `tenants` + `tenant_memberships(role=owner)` |
| 4 | Mike | Selecciona industria (fijo: Painting en MVP) | `tenants.industry_key = 'painting'` |
| 5 | Mike | Elige plan de suscripción (con trial) | `subscriptions(status=trialing)` |

**Casos límite:** email ya registrado en otro tenant (un usuario puede pertenecer a varios tenants — se ofrece "crear nueva empresa" o "unirme a una existente" vía invitación); usuario abandona el wizard a la mitad (el tenant queda en estado incompleto, recuperable al reingresar).

### 2. Business setup

Mike completa: nombre comercial, logo, colores de marca (para PDFs/portal), dirección, teléfono, licencia/seguro (texto libre en MVP), disclaimers legales por defecto, y política de depósito por defecto (%, ver decisión pendiente en Roadmap). Puede invitar a Dana con rol Admin.

**Caso límite:** Mike no configura Stripe todavía — el sistema permite crear estimados y propuestas, pero bloquea el cobro de depósito hasta que `stripe_connected_accounts.charges_enabled = true` (ver [09](09-payments-and-stripe.md)).

### 3. Lead to project

| Paso | Actor | Acción |
|---|---|---|
| 1 | Dana | Registra un lead (nombre, teléfono, dirección, fuente) desde el móvil tras una llamada |
| 2 | Sistema | Crea `opportunities(status=new)` |
| 3 | Dana | Agenda la inspección → `status=inspection_scheduled` |
| 4 | Dana/Mike | Al confirmar que el lead es un cliente real, se crea/vincula `clients` y `projects` |

**Caso límite:** lead duplicado (mismo teléfono/email) — el sistema debe advertir, no bloquear silenciosamente.

### 4. Project inspection

Mike llega al sitio, abre el proyecto desde el móvil, registra `project_addresses` (si difiere de la del cliente), toma fotos (`attachments`), agrega notas de acceso/condición (`project_notes`), y comienza a introducir `project_measurements` superficie por superficie.

**Caso límite:** sin señal en el sitio — se recomienda que el formulario de medición funcione con reintentos de guardado (no offline-first pleno en MVP, pero tolerante a conexión intermitente).

### 5. Estimate creation

Con las mediciones cargadas, el sistema calcula automáticamente cantidades de material y horas de labor sugeridas (ver [07](07-estimating-engine.md)). Mike/Dana revisan, ajustan cantidades, agregan prep/reparaciones, ven el costo total y el margen resultante antes de fijar precio.

**Caso límite:** el margen cae por debajo del mínimo configurado por el tenant → el sistema muestra advertencia visible pero no bloquea (a menos que el rol no tenga permiso `estimates.override_minimum_margin`).

### 6. Good/Better/Best generation

Desde un estimate en estado `draft`, el usuario genera 2–3 opciones. Puede partir de una plantilla (ej. "Good = 1 coat, Better = 2 coats standard paint, Best = 2 coats premium + extended warranty") y ajustar manualmente cada una. Puede pedir a la IA una sugerencia de diferenciación (ver [10](10-ai-boundaries.md)) que **siempre requiere revisión humana** antes de aplicarse.

### 7. Proposal delivery

Mike marca el estimate como `ready`, genera la propuesta (`proposals`, PDF generado async en background job), y la envía por email al cliente con un link único al Client Portal. El estimate version queda congelado (`estimate_versions.sent_at` set) — ver [Entregable 4 — versionado](05-data-model.md).

**Caso límite:** el email rebota — el sistema debe permitir reenviar o copiar el link manualmente.

### 8. Client acceptance

Sarah abre el link (`proposal_link_opened`), navega las opciones (`proposal_option_viewed`), selecciona una (`proposal_option_selected`), revisa inclusiones/exclusiones/garantía, y confirma la aceptación (click-to-accept con registro de IP/user agent/timestamp) → `proposal_accepted`.

**Caso límite:** el link expiró o fue revocado → página de error clara con opción de "solicitar un nuevo link" que notifica al contratista.

### 9. Deposit payment

Inmediatamente después de aceptar (o en un paso separado, configurable), Sarah paga el depósito vía Stripe (Payment Element embebido en el portal). El pago se asocia al `proposals.id` y a la `opportunities` correspondiente.

**Caso límite:** pago falla (tarjeta rechazada) — el estado de la propuesta permanece `accepted` pero el `payments.status=failed`; el portal permite reintentar.

### 10. Estimate revision

Si el cliente pide cambios después de ver la propuesta (antes o después de aceptar pero antes de pagar), Mike/Dana crean una nueva `estimate_version` a partir de la anterior. La versión enviada previamente permanece inmutable y visible en el historial. Si ya existía una propuesta enviada, se marca `superseded` y se genera una nueva.

**Caso límite:** el cliente ya pagó un depósito sobre la versión anterior y luego se revisa el precio — el sistema debe mostrar claramente el depósito ya aplicado y el nuevo balance, nunca "perder" el pago original (soft-linking del pago a la nueva versión mediante el `opportunity_id`, no al `estimate_version_id` directamente — ver [05](05-data-model.md)).

## Open items for this deliverable

- El punto exacto en que se solicita el depósito (inmediatamente tras aceptar vs. paso separado) es una decisión de producto no bloqueante — se define en implementación con un flag configurable por tenant.
