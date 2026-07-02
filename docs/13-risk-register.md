# 13 — Risk Register

Escala: Likelihood (L) y Impact (I) en Low/Medium/High.

| # | Riesgo | L | I | Mitigación | Notas |
|---|---|:---:|:---:|---|---|
| 1 | Scope creep (agregar industrias/features antes de validar painting) | High | Medium | MVP scope congelado en [01](01-mvp-scope.md); cualquier adición pasa por decisión explícita de producto, no se "cuela" en sprints | Disciplina de producto, no técnica |
| 2 | Errores de cálculo financiero (markup/margin/tax) | Medium | High | Suite de tests financieros exhaustiva ([11](11-testing-strategy.md)), fórmulas documentadas y con ejemplo verificado ([07](07-estimating-engine.md)), sin floats para dinero | Máxima prioridad de testing en Phase 4 |
| 3 | Fuga de datos entre tenants (RLS mal configurado) | Low-Medium | High | RLS obligatorio + validación de servidor redundante (defense in depth), tests de aislamiento automatizados | Ver [06](06-security-and-rls.md) |
| 4 | Fallos de Stripe (webhooks perdidos, cuentas Connect no habilitadas) | Medium | High | Idempotencia, `webhook_events`, job de reconciliación periódica, bloqueo de UI si `charges_enabled=false` | Ver [09](09-payments-and-stripe.md) |
| 5 | Webhooks duplicados causan doble efecto de negocio (doble notificación, doble marca de pago) | Medium | Medium | Deduplicación por `provider_event_id`, procesamiento idempotente | — |
| 6 | Links de propuesta rotos o comprometidos (enumeración, expiración mal manejada) | Low | High | Tokens CSPRNG, expiración, revocación, logging de accesos fallidos, mensajes de error uniformes | Ver [06](06-security-and-rls.md) |
| 7 | Sugerencias de IA incorrectas aceptadas sin revisión suficiente | Medium | Medium | Toda sugerencia requiere confirmación humana explícita por línea; nunca escritura automática | Ver [10](10-ai-boundaries.md) |
| 8 | Costo excesivo de IA (uso descontrolado por tenant) | Medium | Medium | Límites de uso por plan (`usage_records`), alertas de costo interno | — |
| 9 | Inconsistencias de renderizado de PDF (fuentes, saltos de página, logos) | Medium | Low-Medium | Usar el mismo motor (Playwright/Chromium) que renderiza el HTML del portal, pruebas visuales de regresión en PDFs de muestra | — |
| 10 | Deliverability de email (propuestas van a spam) | Medium | High | Configurar SPF/DKIM/DMARC desde el día uno, dominio dedicado, monitoreo de bounce/complaint rate | Bloqueante operativo antes de onboarding de clientes reales, no bloqueante para el diseño |
| 11 | Consentimiento de SMS (TCPA/10DLC) si se agrega Twilio | Low (SMS fuera del MVP) | Medium | Diferido explícitamente fuera del MVP; cuando se implemente, requiere flujo de opt-in explícito y registro de consentimiento | **Requiere revisión legal antes de implementar** |
| 12 | Inestabilidad de scraping de precios de proveedores | N/A (fuera de alcance del MVP) | — | No se implementa en el MVP; si se aborda a futuro, evaluar ToS de cada proveedor y alternativas de API oficial | **Requiere revisión legal** antes de considerar scraping |
| 13 | Vendor lock-in (Supabase, Stripe, Render, Claude) | Medium | Medium | Uso de Postgres estándar (portable), AI Gateway abstraído, Stripe es el estándar de facto para Connect (lock-in aceptado conscientemente) | Documentado como trade-off, no como omisión |
| 14 | Costo de almacenamiento de archivos (fotos de alta resolución) | Medium | Low-Medium | Compresión/resize en la subida, políticas de retención a definir | Ver open item en [06](06-security-and-rls.md) |
| 15 | Regulación estatal sobre porcentaje máximo de depósito de contratistas | Medium | High | El sistema permite configurar el % por tenant/estado; determinar el límite legal aplicable es responsabilidad del contratista/asesoría legal | **Requiere revisión legal** — no se codifica como validación automática en el MVP salvo que se decida lo contrario tras esa revisión |
| 16 | Validez legal del "click-to-accept" como aceptación contractual | Medium | Medium-High | Se registra evidencia robusta (IP, user agent, timestamp, contenido exacto aceptado) pero no es una firma electrónica certificada (ej. no cumple todos los estándares de ESIGN/UETA de forma equivalente a DocuSign) | **Requiere revisión legal** antes de posicionar esto como "firma" ante los usuarios |
| 17 | Responsabilidad ante errores de estimado que afecten al contratista frente a su cliente | Low | Medium | Disclaimers claros de que el estimado es una herramienta de apoyo, no una garantía; términos de servicio | **Requiere revisión legal** de los Terms of Service |
| 18 | Concentración de riesgo en Stripe Connect Standard (dependencia de que el contratista complete KYC) | Medium | Medium | UI bloquea cobro hasta onboarding completo; comunicación proactiva al contratista | — |
| 19 | Rendimiento de RLS con subqueries en tablas de alto volumen (`estimate_line_items`, `audit_logs`) | Low (bajo volumen inicial) | Medium | Desnormalización de `tenant_id` en tablas hijas, índices compuestos `(tenant_id, ...)` | Ver [05](05-data-model.md) |
| 20 | Pérdida de trabajo del usuario por conexión intermitente en campo (formularios de medición) | Medium | Medium | Guardado incremental/autosave con reintentos; offline-first pleno diferido pero no bloqueado arquitectónicamente | Ver [01](01-mvp-scope.md) assumptions |

## Riesgos que requieren revisión profesional explícita (no asesoría legal de este documento)

- **#11** Consentimiento SMS/TCPA (cuando se implemente).
- **#12** Legalidad de scraping (si se implementa a futuro).
- **#15** Límites estatales de depósito de contratistas.
- **#16** Validez del "click-to-accept" como mecanismo de aceptación contractual.
- **#17** Términos de servicio y limitación de responsabilidad de Scopevia frente a errores de estimado.

Ninguno de estos puntos bloquea el diseño de la arquitectura; sí deben resolverse (con un abogado especializado en SaaS/contratistas de EE. UU.) antes del lanzamiento comercial público.

## Open items for this deliverable

Ninguno adicional a lo ya señalado arriba.
