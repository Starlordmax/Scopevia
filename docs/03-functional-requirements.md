# 03 — Functional Requirements

Convención de IDs: `<MODULE>-<NNN>`. Prioridad: **P0** (bloqueante para MVP), **P1** (deseable en MVP), **P2** (post-MVP).

> **Nota de estado (2026-07-06):** la sección **PROP — Proposals & Client
> Portal** de abajo describe el diseño original (basado en
> `estimates`/`estimate_versions`), **superseded** por el pivote Phase 2A
> — ver [29-proposal-centric-product-pivot.md](29-proposal-centric-product-pivot.md).
> El flujo real implementado ya no depende de EST/CAT: Proposal se
> construye directamente sobre Client/Opportunity, con su propio motor de
> cálculo (labor + line items), sin Estimating Engine ni Catálogo. La
> sección EST/CAT permanece como registro de diseño para una fase futura
> que aún podría necesitar un catálogo reutilizable de materiales, pero no
> es un prerequisito de Proposals tal como quedó implementado.

## AUTH — Authentication & Session

| ID | Requisito | Prioridad | Criterio de aceptación |
|---|---|---|---|
| AUTH-001 | El usuario puede registrarse con email/password | P0 | Se crea `users` vía Supabase Auth; email de confirmación enviado |
| AUTH-002 | El usuario puede iniciar sesión con Google OAuth | P1 | Login exitoso crea/vincula `users` sin duplicar por email |
| AUTH-003 | El usuario puede recuperar su contraseña | P0 | Flujo estándar de Supabase Auth (magic link/reset) |
| AUTH-004 | La sesión expira y se refresca de forma segura | P0 | Tokens JWT de corta duración + refresh token; ningún secreto expuesto al cliente |
| AUTH-005 | Un usuario puede pertenecer a más de un tenant | P0 | `tenant_memberships` permite N:M user↔tenant; selector de tenant activo en UI |

## ORG — Organization Management

| ID | Requisito | Prioridad | Criterio de aceptación |
|---|---|---|---|
| ORG-001 | El Owner puede crear el tenant y business profile | P0 | `tenants` + `business_profiles` creados en el wizard de onboarding |
| ORG-002 | El Owner/Admin puede invitar miembros por email con un rol asignado | P0 | Invitación con token de expiración de 7 días; el invitado no ve datos del tenant hasta aceptar |
| ORG-003 | El Owner/Admin puede cambiar el rol de un miembro o removerlo | P0 | Solo Owner puede remover a otro Owner; un tenant siempre debe tener ≥1 Owner activo |
| ORG-004 | El Owner puede configurar valores por defecto del negocio (depósito %, márgenes mínimos, disclaimers) | P0 | Persistido en `business_profiles`; usado como default al crear estimates |
| ORG-005 | Un usuario solo ve y opera dentro del tenant activo seleccionado | P0 | Verificado por RLS + validación de servidor, no solo por UI |

## CRM — Leads, Clients, Opportunities

| ID | Requisito | Prioridad | Criterio de aceptación |
|---|---|---|---|
| CRM-001 | Crear una oportunidad (lead) con datos mínimos (nombre, teléfono o email, fuente) | P0 | Registro en <10 segundos desde móvil; `opportunities(status=new)` |
| CRM-002 | Transicionar el estado de una oportunidad según la máquina de estados ([08](08-state-machines.md)) | P0 | Solo transiciones válidas permitidas; transición inválida rechazada por el servidor |
| CRM-003 | Convertir una oportunidad en `clients` + `projects` | P0 | Relación preservada; el historial de la oportunidad no se pierde |
| CRM-004 | Un cliente puede tener múltiples contactos (`client_contacts`) | P1 | Al menos un contacto primario obligatorio |
| CRM-005 | Listar y filtrar oportunidades por estado, fecha, valor estimado | P0 | Filtros funcionales con paginación |
| CRM-006 | Detectar posibles duplicados por teléfono/email al crear una oportunidad | P1 | Advertencia no bloqueante |

## PROJ — Projects

| ID | Requisito | Prioridad | Criterio de aceptación |
|---|---|---|---|
| PROJ-001 | Crear un proyecto vinculado a un cliente con una dirección de trabajo | P0 | `projects` + `project_addresses`; dirección puede diferir de la del cliente |
| PROJ-002 | Adjuntar fotos a un proyecto | P0 | Subida a Supabase Storage con signed URL; asociadas vía `attachments` |
| PROJ-003 | Registrar notas de proyecto (acceso, condiciones, riesgos) | P1 | `project_notes` con autor y timestamp |
| PROJ-004 | Registrar mediciones específicas de painting por superficie | P0 | `project_measurements` según `measurement_definitions` del industry engine |

## EST — Estimating

| ID | Requisito | Prioridad | Criterio de aceptación |
|---|---|---|---|
| EST-001 | Crear un estimate en estado `draft` para un proyecto | P0 | `estimates` + `estimate_versions(version=1, status=draft)` |
| EST-002 | Calcular automáticamente cantidades de material y horas de labor a partir de mediciones | P0 | Fórmulas documentadas en [07](07-estimating-engine.md); resultado editable manualmente |
| EST-003 | Agregar/editar/eliminar line items (materials, labor, prep, equipment, subcontractors, permits, disposal, travel) | P0 | Cada line item guarda snapshot de costo/precio al momento de agregarse |
| EST-004 | Calcular overhead, contingency, taxes, discounts, markup y margen objetivo | P0 | Fórmulas exactas en [07](07-estimating-engine.md); ningún cálculo con floats para dinero |
| EST-005 | Mostrar advertencia si el margen resultante cae por debajo del mínimo configurado | P0 | Advertencia visible; bloqueo opcional según permiso de rol |
| EST-006 | Crear opciones Good/Better/Best dentro de una estimate version | P0 | `estimate_options` con line items propios, no solo % distinto |
| EST-007 | Duplicar una opción existente como punto de partida | P1 | Copia profunda de line items |
| EST-008 | Marcar una opción como "recomendada" | P1 | Un único flag `is_recommended` por estimate version |
| EST-009 | Crear una nueva versión de un estimate ya enviado, preservando la anterior sin cambios | P0 | Versión previa inmutable (`sent_at` congela el registro); nueva versión referencia a la anterior |
| EST-010 | Transicionar el estado del estimate según la máquina de estados | P0 | Ver [08](08-state-machines.md) |

## CAT — Catalog & Pricing

| ID | Requisito | Prioridad | Criterio de aceptación |
|---|---|---|---|
| CAT-001 | Crear/editar materiales del catálogo propio del tenant | P0 | `material_catalog_items` con unidad, costo, precio, supplier |
| CAT-002 | Crear/editar tarifas de mano de obra propias del tenant | P0 | `labor_catalog_items` con costo/hora, productividad por tipo de tarea |
| CAT-003 | Importar catálogo vía CSV | P1 | Validación de formato; reporte de filas rechazadas |
| CAT-004 | Historial de cambios de precio de un ítem de catálogo | P1 | `price_sources`/histórico de precio; no afecta estimados ya creados |
| CAT-005 | Los line items de un estimate son snapshots inmutables del catálogo al momento de agregarse | P0 | Cambiar el precio del catálogo no altera estimados existentes |

## PROP — Proposals & Client Portal

| ID | Requisito | Prioridad | Criterio de aceptación |
|---|---|---|---|
| PROP-001 | Generar una propuesta a partir de una estimate version en estado `ready` | P0 | `proposals(status=draft)` → `generated` tras generar PDF async |
| PROP-002 | Enviar la propuesta al cliente por email con link único | P0 | `proposal_recipients` + token no predecible; evento `proposal.sent` |
| PROP-003 | El cliente accede al portal sin necesidad de crear cuenta | P0 | Acceso vía token firmado con expiración configurable |
| PROP-004 | El cliente puede ver y comparar las opciones Good/Better/Best | P0 | UI de comparación clara de inclusiones/exclusiones/precio |
| PROP-005 | El cliente puede seleccionar una opción y aceptar | P0 | Registro de `proposal_acceptances` con IP, user agent, timestamp |
| PROP-006 | El cliente puede descargar el PDF de la propuesta | P1 | PDF generado coincide exactamente con la versión aceptada |
| PROP-007 | Registrar eventos de interacción del cliente (apertura, vista de opción, selección) | P0 | `proposal_events` — ver lista de eventos en [11 del prompt / 04](04-system-architecture.md) |
| PROP-008 | Un link de propuesta puede expirar o ser revocado manualmente | P0 | Acceso posterior muestra error controlado, no un 500 |
| PROP-009 | Una propuesta aceptada/pagada no puede modificarse silenciosamente | P0 | Cualquier cambio posterior exige nueva versión y nueva propuesta (`superseded`) |

## PAY — Payments & Billing

| ID | Requisito | Prioridad | Criterio de aceptación |
|---|---|---|---|
| PAY-001 | El tenant conecta su cuenta de Stripe (Connect Standard) | P0 | Onboarding hospedado por Stripe; estado reflejado en `stripe_connected_accounts` |
| PAY-002 | El cliente paga un depósito desde el portal | P0 | Payment Intent con `application_fee_amount`; confirmado vía webhook, no vía respuesta del navegador |
| PAY-003 | Los webhooks de Stripe se procesan de forma idempotente | P0 | `webhook_events` deduplica por `stripe_event_id` |
| PAY-004 | El contratista paga su suscripción SaaS a Scopevia | P0 | Stripe Billing en la cuenta plataforma, independiente de Stripe Connect del contratista |
| PAY-005 | Reflejar el estado de un pago (pending/succeeded/failed/refunded/disputed) | P0 | `payments` + `payment_events`; UI refleja el estado real, no un optimista |
| PAY-006 | Registrar reembolsos (totales/parciales) | P1 | Requiere permiso `payments.refund`; genera audit log |

## NOTIF — Notifications

| ID | Requisito | Prioridad | Criterio de aceptación |
|---|---|---|---|
| NOTIF-001 | Notificar por email al contratista cuando el cliente ve/acepta/paga | P0 | Envío async vía background job |
| NOTIF-002 | Notificar por email al cliente al recibir la propuesta | P0 | Incluye link único |
| NOTIF-003 | El usuario puede configurar sus preferencias de notificación | P2 | `notification_preferences` |

## DASH — Dashboard

| ID | Requisito | Prioridad | Criterio de aceptación |
|---|---|---|---|
| DASH-001 | Ver pipeline de oportunidades por estado | P0 | Conteo y valor total por estado |
| DASH-002 | Ver tasa de aceptación de propuestas | P0 | Fórmula exacta documentada en [04](04-system-architecture.md) |
| DASH-003 | Ver revenue contratado vs. cobrado | P0 | Distinción explícita entre "accepted value" y "collected value" |

## AI — Assistance

| ID | Requisito | Prioridad | Criterio de aceptación |
|---|---|---|---|
| AI-001 | Sugerir descripción de alcance de trabajo a partir de mediciones | P1 | Sugerencia editable; requiere aceptación humana explícita |
| AI-002 | Sugerir line items faltantes según el tipo de proyecto | P1 | No se agregan automáticamente sin confirmación |
| AI-003 | Registrar toda recomendación de IA con su resultado (aceptada/rechazada/editada) | P0 | `ai_recommendations` — ver [10](10-ai-boundaries.md) |

## AUDIT — Audit & Compliance

| ID | Requisito | Prioridad | Criterio de aceptación |
|---|---|---|---|
| AUDIT-001 | Registrar cambios de precio, margen, envío, aceptación y pago | P0 | `audit_logs` inmutable, con actor, acción, entidad, timestamp |
| AUDIT-002 | Un usuario con permiso `audit.view` puede consultar el historial de una entidad | P1 | UI de auditoría por entidad |

## BILL — Subscription Billing

| ID | Requisito | Prioridad | Criterio de aceptación |
|---|---|---|---|
| BILL-001 | El tenant tiene un plan de suscripción con límites (ej. # de propuestas enviadas/mes) | P0 | `subscription_plans` + `subscriptions` + `usage_records` |
| BILL-002 | El sistema bloquea o advierte al alcanzar el límite del plan | P1 | Mensaje claro con CTA de upgrade |

## Open items for this deliverable

- El listado exacto de campos por formulario (ej. campos obligatorios de `opportunities`) se refina en la fase de diseño de UI, no bloquea la arquitectura.
