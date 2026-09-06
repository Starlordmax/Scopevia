# 00 — Product Vision

> **Nota de estado (2026-07-06):** Phase 2A cambió la propuesta de valor
> principal — ver [29-proposal-centric-product-pivot.md](29-proposal-centric-product-pivot.md).
> La nueva promesa central es *"Create professional proposals, showcase
> your work, price your time, and win more jobs"*. El flujo ya no exige
> un Project antes de cotizar; Proposal es ahora el paso inmediato
> después de Opportunity. Good/Better/Best, el motor de estimación por
> industria, y el Client Portal siguen siendo visión válida a futuro,
> pero no son parte de lo ya implementado.

## Product vision

> **Scopevia** ayuda a contratistas independientes y pequeñas empresas de construcción a convertir una inspección de campo en un estimado profesional, con opciones Good/Better/Best, en minutos en lugar de horas — y a cobrar más rápido gracias a un portal de cliente y pagos integrados.

Visión a 3 años: Scopevia se convierte en el sistema operativo comercial (CRM + Estimating + Proposals + Payments) para contratistas residenciales en Estados Unidos, comenzando por **Painting** y expandiéndose a otras industrias mediante una arquitectura de "industry plugins" sin reescribir el core.

## Problem statement

Los contratistas pequeños y medianos (1–30 empleados) pierden negocio y márgenes por:

| Problema | Consecuencia |
|---|---|
| Estimados hechos a mano, en papel, Excel o apps genéricas de invoicing | Errores de cálculo, subvaloración de mano de obra, inconsistencia entre estimadores |
| No presentan opciones — un solo precio "take it or leave it" | Menor tasa de cierre, no capturan clientes con mayor disposición a pagar (upsell Good/Better/Best) |
| Propuestas poco profesionales (PDF plano o nada) | Percepción de baja calidad frente a competidores con mejor presentación |
| El cliente no tiene forma fácil de aprobar o pagar un depósito | Ciclos de venta más largos, fricción de cobro, dependencia de cheques/efectivo |
| Sin visibilidad de pipeline ni métricas | Decisiones de negocio a ciegas (cuánto está "en juego", tasa de cierre real) |
| Software existente (Jobber, ServiceTitan, Housecall Pro) es genérico, caro o no está optimizado para estimar con mediciones específicas de industria | Los contratistas de nicho (painting, flooring, roofing) siguen usando hojas de cálculo |

## Target customer

- **Segmento primario (MVP):** Painting contractors residenciales en EE. UU., 1–15 empleados, que ya cobran depósitos y buscan verse más profesionales frente a clientes residenciales de gama media/alta.
- **Segmento secundario (post-MVP):** Otras trades residenciales (flooring, drywall, roofing, remodeling) con estructuras de estimado similares (superficie × costo unitario + labor + prep).
- **No objetivo en el MVP:** Grandes constructoras generales, proyectos comerciales complejos con licitación pública, contratistas sin smartphone/uso digital.

## Primary personas

Ver detalle completo en [02-personas-and-journeys.md](02-personas-and-journeys.md). Resumen:

1. **Owner-Operator ("Mike the Painter")** — dueño que también estima y vende. Usa el móvil en campo.
2. **Office Estimator/Admin** — procesa estimados y propuestas desde una laptop en oficina.
3. **Field Worker** — solo necesita ver el proyecto asignado, fotos y notas; no toca precios.
4. **Homeowner Client** — recibe el link de la propuesta, compara opciones, acepta y paga el depósito desde su teléfono.

## Jobs to be done

| Job | Cuando... | Quiero... | Para... |
|---|---|---|---|
| Capturar oportunidad | Recibo una llamada o formulario de un lead | Registrarlo en segundos desde el móvil | No perder el seguimiento |
| Medir y calcular | Estoy parado frente a la casa del cliente | Introducir medidas y ver el costo estimado al instante | Dar un precio confiable sin volver a la oficina |
| Ofrecer opciones | El cliente pregunta "¿qué más me puede ofrecer?" | Mostrar Good/Better/Best con precios y diferencias claras | Aumentar el ticket promedio y cerrar más rápido |
| Enviar y hacer seguimiento | Termino el estimado | Enviar una propuesta profesional por link | Que el cliente decida sin necesitar una llamada adicional |
| Cobrar | El cliente acepta | Cobrar el depósito de inmediato desde la propuesta | Asegurar el trabajo y empezar a comprar materiales |
| Medir el negocio | Es fin de mes | Ver cuánto tengo en pipeline, cuánto cerré, cuánto cobré | Tomar decisiones (contratar, comprar equipo, invertir en marketing) |

## Value proposition

> **Help contractors create accurate estimates, win more jobs, and get paid faster.**

Scopevia no es "una app de IA para pintores". Es el flujo comercial completo (Lead → Cash) especializado por industria, donde la IA es un acelerador opcional, no el producto.

## Competitive differentiation

| Dimensión | Jobber / Housecall Pro | ServiceTitan | Hojas de cálculo / PDF manual | **Scopevia** |
|---|---|---|---|---|
| Especialización por industria (mediciones, catálogo) | Genérico | Genérico, enfocado en HVAC/plumbing/electrical | Ninguna | Motor de estimación específico por industria, empezando por painting |
| Good/Better/Best real (no solo % de markup) | Limitado o inexistente | Parcial | Manual | Core del producto, con variación de alcance/material/garantía por opción |
| Precio y complejidad | Medio-alto, requiere onboarding largo | Alto, orientado a empresas grandes | Gratis pero manual | SaaS accesible para 1–15 empleados |
| Mobile-first para estimar en campo | Parcial | Parcial | No | Diseñado mobile-first desde el día uno |
| Portal de cliente con comparación de opciones y pago de depósito | Parcial | Sí (compañías grandes) | No | Sí, incluido en el flujo estándar |
| IA como asistente acotado y auditable | Incipiente/ninguno | Incipiente | No | Con límites explícitos y trazabilidad (ver [10-ai-boundaries.md](10-ai-boundaries.md)) |

## Success metrics

**North Star Metric:** *Total proposal value accepted per month, por tenant activo* (mide si el producto realmente ayuda a ganar trabajo, no solo a generar documentos).

Métricas de soporte:

| Métrica | Fórmula / fuente | Por qué importa |
|---|---|---|
| Activation rate | % de tenants que crean y envían al menos 1 propuesta en los primeros 14 días | Mide si el onboarding lleva al valor real |
| Proposal acceptance rate | proposals accepted / proposals sent (ver definición exacta en [17](../docs/04-system-architecture.md)) | Mide si el producto ayuda a cerrar negocio |
| Time to first estimate | Tiempo entre signup y primer estimate en estado `ready` | Mide fricción de onboarding |
| Average time to acceptance | Tiempo entre `proposal.sent_at` y `proposal.accepted_at` | Mide si el portal reduce el ciclo de venta |
| Deposit collection rate | deposits collected / proposals accepted | Mide si Stripe Connect realmente resuelve el cobro |
| Monthly recurring revenue (MRR) | Suma de subscripciones activas | Salud del negocio SaaS |
| Net revenue retention | Incluye upgrades, downgrades, churn | Salud a largo plazo |

## Open items for this deliverable

Ninguno bloqueante. Ver evaluación final de preparación al cierre de la respuesta.
