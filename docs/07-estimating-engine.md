# 07 — Estimating Engine Specification

## Principios

1. El motor es **determinista**: mismos inputs → mismo output, siempre. No hay aleatoriedad ni llamadas a IA dentro del cálculo de precio.
2. La IA puede **sugerir** inputs (ej. cantidad de line items faltantes) pero **nunca** calcula el precio final ni lo modifica directamente — ver [10-ai-boundaries.md](10-ai-boundaries.md).
3. Todo dinero se calcula en **enteros (cents)**; toda fracción/porcentaje en `numeric` de precisión fija. Nunca `float`/`double` para dinero.

## Unidades y variables (painting)

| Variable | Origen | Tipo |
|---|---|---|
| `length`, `width`, `height` | Usuario (medición) | Introducida |
| `gross_area` | Calculada: fórmulas abajo | Calculada |
| `deductible_openings` (doors, windows, etc.) | Usuario | Introducida |
| `net_area` | Calculada | Calculada |
| `number_of_coats` | Usuario, con default por tipo de superficie configurable por tenant | Introducida (default configurable) |
| `paint_coverage_per_gallon` | Catálogo del material seleccionado | Del catálogo |
| `primer_coverage_per_gallon` | Catálogo | Del catálogo |
| `waste_percentage` | Configurable por tenant, default del sistema (ej. 10%) | Configurable por tenant |
| `labor_productivity` (unidades/hora por tarea) | Catálogo de labor del tenant | Configurable por tenant |
| `crew_size` | Usuario | Introducida |
| `hourly_labor_cost` | Catálogo de labor del tenant | Configurable por tenant |
| `difficulty_factor` | Usuario (selección: standard/moderate/difficult) mapeado a multiplicador configurable por tenant | Introducida + configurable |
| `surface_condition` | Usuario (good/fair/poor) | Introducida |
| `material_quality` | Determinada por la opción (Good/Better/Best) vía el material seleccionado | Derivada de la opción |
| `number_of_colors` | Usuario | Introducida |
| `occupied_or_vacant` | Usuario | Introducida (afecta prep/protección, no la fórmula base) |
| `access_complexity` | Usuario | Introducida (afecta labor vía difficulty_factor) |

**Congelado como snapshot en el estimate:** todas las anteriores, en el momento en que se agrega el line item — ver [05-data-model.md](05-data-model.md#estimate_line_items). Cambios posteriores al catálogo o a la medición del proyecto **no** alteran un line item ya creado.

**Plantillas:** `measurement_definitions` provee defaults razonables por tipo de superficie (ej. 2 coats para exterior siding); el usuario puede sobreescribirlos por proyecto.

## Fórmulas base (Painting)

### Área

```text
Gross Area (walls)   = Perimeter × Height
                      = 2 × (Length + Width) × Height

Net Area              = Gross Area − Deductible Openings

Deductible Openings   = Σ (door_area, window_area, ...)
  door_area default   = 21 sqft (configurable por tenant)
  window_area default = 15 sqft (configurable por tenant)
```

### Material (pintura)

```text
Paint Gallons Needed = ceil( (Net Area × Number of Coats × (1 + Waste %)) / Coverage per Gallon )

Primer Gallons Needed = ceil( (Net Area × (1 + Waste %)) / Primer Coverage per Gallon )   [si aplica primer]
```

`ceil` se aplica sobre galones (no se vende media lata) — regla de redondeo explícita, ver sección de Rounding.

### Labor

```text
Labor Hours = (Net Area / Labor Productivity per Hour) × Difficulty Factor

Labor Cost  = Labor Hours × Hourly Labor Cost × Crew Size   [si el rate es por trabajador]
```

`Labor Productivity per Hour` viene del catálogo de labor del tenant, específico por categoría de superficie (walls, trim, ceilings tienen productividad distinta).

## Estructura de costos (orden de agregación)

```text
1. Materials Cost        = Σ line items categoría "material"
2. Labor Cost             = Σ line items categoría "labor"
3. Equipment Cost         = Σ line items categoría "equipment"
4. Subcontractor Cost     = Σ line items categoría "subcontractor"
5. Permits Cost           = Σ line items categoría "permit"
6. Disposal Cost          = Σ line items categoría "disposal"
7. Travel Cost            = Σ line items categoría "travel"

   Direct Cost            = suma de 1..7

8. Overhead               = Direct Cost × overhead_rate   (estimate_adjustments.type='overhead')
9. Contingency             = (Direct Cost + Overhead) × contingency_rate  (type='contingency')

   Total Cost             = Direct Cost + Overhead + Contingency
```

## Markup vs. Margin — definición y fórmula obligatoria

```text
Markup = Profit / Cost
Margin = Profit / Selling Price

Selling Price (a partir de un Target Margin) = Total Cost / (1 − Target Margin)
```

**Ejemplo obligatorio del prompt, verificado:**

```text
Total Cost: $100.00
Target Margin: 30%
Selling Price = 100 / (1 − 0.30) = 100 / 0.70 = $142.86
```

Confirmación: sumar 30% al costo ($130.00) produce un margen real de `30/130 = 23.08%`, **no** 30%. El motor **siempre** calcula el precio de venta a partir del margen objetivo con la fórmula de división, nunca sumando el porcentaje al costo, salvo que el usuario elija explícitamente el modo "Markup" (ver abajo).

### Dos modos de pricing, explícitos y visibles al usuario

| Modo | Fórmula | Cuándo se usa |
|---|---|---|
| `target_margin` (default recomendado) | `Selling Price = Total Cost / (1 − margin)` | Precio orientado a rentabilidad objetivo |
| `markup_percentage` | `Selling Price = Total Cost × (1 + markup)` | Contratistas acostumbrados a pensar en "markup" tradicional |

El estimate_option guarda explícitamente `pricing_mode` y el valor usado, para que el margen resultante mostrado sea siempre calculado y exhibido (nunca asumido), independientemente del modo elegido.

## Orden de aplicación de ajustes (obligatorio, en este orden)

```text
1. Direct Cost (materials + labor + equipment + subcontractor + permits + disposal + travel)
2. + Overhead
3. + Contingency
   = Total Cost
4. → Apply pricing mode (target margin OR markup) → Selling Price (pre-tax, pre-discount)
5. − Discounts (percentage o fixed_amount, sobre Selling Price)
6. + Taxes (sobre el subtotal post-discount; solo line items con tax_status_snapshot = 'taxable')
7. + Fees (fixed_amount, ej. credit card processing fee si se traslada al cliente)
   = Final Price
```

Cada paso es una fila de `estimate_adjustments` con `sort_order` explícito — el motor ejecuta en ese orden, no en el orden de inserción en la UI.

## Impuestos (taxes)

- `tax_rate` configurable por tenant (y potencialmente por `project_addresses.state`/`postal_code` en fases futuras; MVP usa una tasa única por tenant).
- Se aplica solo sobre line items marcados `taxable` — la mayoría de estados de EE. UU. no gravan labor de servicios de la misma forma que materiales; el `tax_status_snapshot` por line item permite reflejar esto correctamente en vez de una tasa plana sobre todo. **Nota:** las reglas fiscales varían por estado/condado — el sistema permite configurar el comportamiento correcto, pero determinar la regla aplicable es responsabilidad del contratista/su contador, no una validación legal del software.

## Descuentos

- `percentage` (sobre Selling Price antes de impuestos) o `fixed_amount` (cents).
- No pueden dejar el `Final Price` por debajo de `Total Cost` sin una advertencia explícita y permiso `estimates.override_minimum_margin`.

## Depósitos y precios mínimos

- `deposit_percent` se calcula sobre `Final Price` de la opción seleccionada por el cliente, no sobre el Total Cost.
- `min_margin` (a nivel `business_profiles` o `estimate_version`) dispara una advertencia visible si el margen real resultante (`(Final Price − Total Cost) / Final Price`) cae por debajo del umbral — ver EST-005 en [03](03-functional-requirements.md).

## Overrides manuales

- Un usuario con permiso puede sobreescribir manualmente el `Final Price` de una opción (`manual_price_override_cents`). Cuando esto ocurre:
  - El margen mostrado se **recalcula** a partir del override, nunca se oculta.
  - Se genera un `audit_logs` con el precio calculado original vs. el override.
  - Requiere permiso `estimates.edit_margin` como mínimo.

## Rounding rules

| Contexto | Regla |
|---|---|
| Galones de pintura/primer | `ceil` al entero (no se compran fracciones de galón) |
| Horas de labor | Redondeo a 0.25 hora (`round(hours × 4) / 4`) — configurable por tenant |
| Montos monetarios intermedios | Se mantienen en cents enteros mediante redondeo **half-up** en cada paso que produce un monto final de línea (no se acumulan fracciones de centavo sin resolver) |
| Porcentajes almacenados | `numeric(7,4)` — 4 decimales de precisión (soporta hasta 0.01% de granularidad) |
| Precio final mostrado al cliente | Siempre en cents enteros, formateado a 2 decimales de dólar |

## Validaciones del motor

- `Net Area >= 0` (si las aberturas deducibles exceden el área bruta, se rechaza con error, no se permite área negativa).
- `Number of Coats >= 1`.
- `Total Cost > 0` antes de permitir transición a `ready`.
- Advertencia (no bloqueo, salvo permiso) si `Final Price < Total Cost` o margen `< min_margin`.
- Un `estimate_version` no puede transicionar a `ready` si tiene 0 `estimate_options` o si alguna opción tiene 0 line items.

## Snapshots — qué se congela y cuándo

| Momento | Qué se congela |
|---|---|
| Al agregar un line item | Snapshot completo del catálogo (nombre, unidad, costo, precio, supplier, fecha, tax status) — ver [05](05-data-model.md#estimate_line_items) |
| Al marcar `estimate_versions.status = ready` | Los totales calculados (`subtotal_cost_cents`, `subtotal_price_cents`, `total_price_cents`) se persisten, no se recalculan on-the-fly en cada lectura (para performance y para que una revisión posterior del catálogo no cambie visualmente un estimate ya revisado) |
| Al generar una `proposals` (envío) | `estimate_versions.locked_at` — inmutabilidad total, incluyendo snapshots ya guardados |

## Good / Better / Best — lógica de diferenciación

Cada opción es una `estimate_options` independiente con su propio conjunto de `estimate_line_items` — **no** un multiplicador aplicado a una opción base. Dimensiones que pueden variar entre opciones (ver [09 del prompt] / sección 9):

| Dimensión | Ejemplo Good | Ejemplo Better | Ejemplo Best |
|---|---|---|---|
| Material brand/quality | Pintura económica | Pintura media | Pintura premium + primer especializado |
| Number of coats | 1 coat (donde aplique) | 2 coats | 2 coats + touch-up incluido |
| Preparation level | Prep esencial (scraping básico) | Prep mejorada (sanding, patching) | Prep completa (mold treatment, caulking extendido) |
| Warranty | Limitada (ej. 1 año) | Estándar (ej. 2 años) | Extendida (ej. 5 años) |
| Included services | Mínimos | Cleanup estándar | Cleanup premium + furniture moving |
| Timeline | Más rápido, menor equipo | Estándar | Prioridad de agenda |
| Target margin | Puede ser menor (volumen/competitividad) | Estándar del negocio | Puede ser mayor (valor percibido) |

El contratista puede: generar las 3 automáticamente desde una plantilla del tenant, duplicar una opción existente, editar line items individualmente, reordenar, renombrar, ocultar (`is_hidden`) sin borrar, y marcar una como `is_recommended`. El margen de cada opción se muestra siempre de forma independiente — nunca se asume que las tres tienen el mismo margen objetivo.

## Open items for this deliverable

- Tabla de productividad de labor por defecto (valores concretos ej. sqft/hora por tipo de superficie) es un dato de producto/negocio a definir con expertos de la industria antes de sembrar las plantillas — no bloquea el diseño del motor, sí bloquea la carga de datos semilla.
