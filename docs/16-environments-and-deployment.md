# 16 — Environments and Deployment

## Ambientes

| Ambiente | Supabase project | Propósito | Acceso |
|---|---|---|---|
| Development | Local (`supabase start`, Docker) o un proyecto Supabase de desarrollo compartido | Trabajo diario individual | Desarrolladores |
| Staging | Proyecto Supabase dedicado | QA, pruebas de integración, demos | Equipo interno |
| Production | Proyecto Supabase dedicado | Usuarios reales | Restringido |

**Regla dura:** development nunca se conecta a la base de staging o production. Cada ambiente tiene su propio proyecto Supabase (o instancia local), sus propias claves, y su propio dominio de email de auth.

## Variables de entorno por ambiente

Cada ambiente necesita su propio set de:

```env
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SITE_URL
```

`SUPABASE_SERVICE_ROLE_KEY` es secreto — se configura como variable de entorno del servicio de despliegue (nunca en un archivo commiteado, nunca con prefijo `NEXT_PUBLIC_`). Ver [.env.example](../.env.example).

## Migraciones

Las migraciones en `supabase/migrations/` son la única fuente de verdad del esquema. Flujo recomendado:

1. Desarrollar y probar la migración localmente (`npm run db:reset`).
2. Aplicar a staging: `npx supabase db push --project-ref <staging-ref>` (o el pipeline de CI/CD equivalente).
3. Verificar en staging (incluyendo la suite de RLS apuntando a staging con credenciales de prueba dedicadas, nunca datos reales).
4. Aplicar a production con el mismo mecanismo, en una ventana de despliegue planeada.

**Nunca** se edita el esquema manualmente desde el Dashboard de Supabase en staging/production — cualquier cambio hecho así queda fuera del control de versiones y diverge del historial de migraciones. Si ocurre por error, usar `npm run db:diff` para capturarlo retroactivamente como una migración antes de seguir.

## Redirect URLs y confirmación de email

`supabase/config.toml` define `site_url` y `additional_redirect_urls` para el ambiente **local**. Para staging/production, estos valores se configuran en el Dashboard de Supabase (Authentication → URL Configuration) del proyecto correspondiente, apuntando al dominio real de cada ambiente (p. ej. `https://staging.scopevia.app`, `https://app.scopevia.app`), incluyendo el patrón `/auth/callback` usado por `src/app/auth/callback/route.ts`.

## Cookies

`src/lib/auth/tenant.ts` configura la cookie de tenant activo como `secure: process.env.NODE_ENV === "production"`. Esto significa:

- En local (`npm run dev`, HTTP), la cookie se setea sin el flag `Secure` (necesario porque `localhost` normalmente no sirve HTTPS).
- En staging/production, `NODE_ENV=production` (estándar en cualquier build de Next.js), por lo que la cookie siempre lleva `Secure` — solo viaja sobre HTTPS.

## Despliegue (Render, según el stack objetivo del diseño de producto)

Aunque Phase 0 no configura infraestructura de despliegue real, la arquitectura asume:

- Un servicio web (Next.js) por ambiente.
- Variables de entorno gestionadas por el proveedor de hosting, no en el repositorio.
- El worker de background jobs (PDF, email, IA) mencionado en el diseño de producto ([04-system-architecture.md](04-system-architecture.md)) no existe todavía — Phase 0 no tiene jobs asíncronos.

## Rollback / forward-fix

Este proyecto sigue una estrategia de **forward-fix**, no de rollback automático de migraciones:

- Si una migración introduce un problema en staging/production, se corrige con una **nueva** migración que revierte o ajusta el cambio — nunca editando ni borrando una migración ya aplicada en un ambiente compartido.
- Excepción: mientras una migración exista **solo** en local y no se haya compartido/mergeado, sí puede editarse libremente (`npm run db:reset` la vuelve a aplicar desde cero).

## Monitoreo

Sentry no está configurado todavía en Phase 0 (planeado en el diseño de producto, [04-system-architecture.md](04-system-architecture.md)). Hasta entonces, los errores de servidor se ven en los logs del proceso Next.js (`console.error` en `src/lib/audit/log.ts` para fallos de auditoría, y los logs estándar de Next.js/Supabase para el resto).

## Checklist antes de promover Phase 0 a un ambiente compartido (staging)

1. Proyecto Supabase de staging creado.
2. `npm run db:reset` ejecutado contra staging (o el equivalente `db push` con migraciones limpias).
3. Variables de entorno de staging configuradas en el proveedor de hosting.
4. Redirect URLs de Auth configuradas para el dominio de staging.
5. Suite de RLS (`npm run test:rls`) ejecutada contra staging con usuarios de prueba dedicados, luego eliminados.
6. Verificación manual del checklist en [14-phase-0-foundations.md](14-phase-0-foundations.md) / sección "Manual verification checklist" del reporte de entrega.
