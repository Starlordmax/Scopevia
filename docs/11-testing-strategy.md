# 11 — Testing Strategy

| Tipo de prueba | Qué cubre | Herramienta sugerida | Prioridad | Ejemplos concretos |
|---|---|---|---|---|
| Unit tests | Funciones puras: motor de estimación, formateo de dinero, utilidades de fecha/estado | Vitest/Jest | P0 | `sellingPriceFromMargin(cost, margin)`, `calculatePaintGallons(...)`, redondeo de horas |
| Integration tests | Rutas de API contra una base de datos real (Supabase local/test), incluyendo RLS activo | Vitest/Jest + Supabase test instance | P0 | Crear estimate → agregar line items → marcar ready → verificar totales persistidos |
| RLS tests | Verificar que un usuario del Tenant A **nunca** puede leer/escribir datos del Tenant B, incluso manipulando IDs | pgTAP o suite de integración con clientes autenticados como distintos tenants | P0 | Intentar `SELECT`/`UPDATE` de `opportunities` de otro tenant vía API y vía cliente Postgres directo |
| Financial calculation tests | Casos exhaustivos de markup/margin/tax/discount/waste, incluyendo el ejemplo obligatorio ($100 cost, 30% margin → $142.86) | Unit tests dedicados | P0 | Verificar que sumar 30% al costo NO produce 30% de margen (test de regresión explícito) |
| State transition tests | Solo transiciones válidas de las máquinas de estado permitidas; transiciones inválidas rechazadas | Unit + integration | P0 | Intentar `proposal.sent → proposal.accepted` sin pasar por `option_selected` debe fallar si el flujo lo exige |
| Webhook tests | Idempotencia, verificación de firma, manejo de eventos fuera de orden | Integration con payloads de fixture de Stripe (Stripe CLI / stripe-mock) | P0 | Reenviar el mismo `payment_intent.succeeded` dos veces no debe duplicar el efecto |
| End-to-end tests | Journeys completos críticos de negocio | Playwright | P0 (journeys core), P1 (edge cases) | Signup → estimate → proposal → client accepts → deposit paid |
| Mobile responsive tests | Layout y usabilidad en viewport móvil real | Playwright con viewport emulation + revisión manual en dispositivo | P0 | Formulario de medición usable con una mano en un iPhone SE |
| Accessibility tests | Contraste, navegación por teclado, labels de formularios | axe-core / Playwright + axe | P1 | Formularios de estimate y portal de cliente pasan checks automáticos de axe |
| Tenant isolation tests | Ver "RLS tests" — se distingue porque cubre también aislamiento a nivel de Storage (signed URLs) y de background jobs | Integration | P0 | Un signed URL generado para el Tenant A no debe servir un archivo del Tenant B |

## Prioridades por journey crítico (E2E)

| Journey | Prioridad E2E |
|---|---|
| Contractor onboarding → business setup | P0 |
| Lead → project → estimate → GBB → proposal → sent | P0 |
| Client portal: view → compare → select → accept | P0 |
| Deposit payment (incluyendo fallo de pago) | P0 |
| Estimate revision tras propuesta enviada | P1 |
| Invitar miembro y validar permisos por rol | P1 |
| Reembolso parcial | P2 |

## Qué NO se prueba exhaustivamente en el MVP (y por qué)

- Carga/performance a gran escala — el volumen esperado del MVP no lo justifica; se define un smoke test de carga básico antes de escalar marketing.
- Compatibilidad con navegadores legacy (IE11, etc.) — fuera del público objetivo (contratistas con smartphones modernos).
- Pruebas exhaustivas de accesibilidad WCAG AA completas — se cubre lo esencial (P1), auditoría completa se agenda post-MVP.

## Datos y ambientes de prueba

- Los tests de integración/RLS corren contra una instancia de Supabase dedicada a CI (proyecto de test o Supabase local vía Docker), nunca contra staging/production.
- Fixtures de Stripe vía `stripe-mock` o modo test + `Stripe CLI` para simular webhooks localmente y en CI.
- Datos sintéticos (nunca PII real) en cualquier ambiente que no sea production.

## Gate de CI recomendado

1. Lint + type-check (bloqueante).
2. Unit tests (bloqueante).
3. Integration + RLS tests (bloqueante).
4. E2E de journeys P0 (bloqueante en PRs a `main`; smoke subset en cada PR, suite completa nightly).
5. Accessibility checks P1 (advertencia, no bloqueante inicialmente; se vuelve bloqueante cuando la cobertura sea estable).

## Open items for this deliverable

- Selección final de runner E2E (Playwright asumido, coherente con el uso ya mencionado para PDF) — no bloqueante.
