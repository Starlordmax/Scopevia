# 15 — Local Development

## Requisitos

- Node.js ≥ 20 (probado con v22).
- npm (el proyecto usa `package-lock.json`; no cambiar de package manager).
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — requerido por el Supabase CLI para levantar Postgres/Auth/Storage localmente.
- Cuenta de Supabase solo si vas a conectar a un proyecto remoto (no es necesaria para desarrollo 100% local).

## Instalación

```bash
npm install
cp .env.example .env.local
```

Completa `.env.local` con las credenciales de tu proyecto Supabase local (ver siguiente sección) o remoto de desarrollo.

## Levantar Supabase localmente

```bash
npm run db:start   # supabase start — requiere Docker corriendo
```

Al iniciar, la CLI imprime la URL de la API, el `anon key` y el `service_role key` locales. Cópialos a `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<el que imprime supabase start>
SUPABASE_SERVICE_ROLE_KEY=<el que imprime supabase start>
```

Studio local (UI de administración) queda disponible en `http://127.0.0.1:54323`. El servidor de pruebas de email (para ver los correos de confirmación/reset sin un proveedor real) queda en `http://127.0.0.1:54324`.

## Aplicar migraciones y seeds

```bash
npm run db:reset
```

`supabase db reset` recrea la base desde cero, aplica **todas** las migraciones en `supabase/migrations/` en orden, y luego ejecuta `supabase/seed.sql`. Es la forma recomendada de verificar que las migraciones funcionan desde una base vacía (requisito de Phase 0) — ejecútalo después de cualquier cambio a una migración.

Para generar una nueva migración vacía a partir de aquí en adelante:

```bash
npx supabase migration new nombre_descriptivo
```

## Levantar la aplicación

```bash
npm run dev
```

Abre `http://localhost:3000`. Deberías ser redirigido a `/sign-in`.

## Crear un usuario de prueba

Regístrate normalmente desde `/sign-up`. Como el proveedor de email es el servidor local de pruebas (no un proveedor real), el correo de confirmación **no se envía de verdad** — ábrelo en `http://127.0.0.1:54324` (Inbucket/Mailpit, según la versión de la CLI) y haz clic en el link de confirmación para completar el signup.

Alternativamente, para pruebas rápidas sin flujo de email, puedes crear un usuario ya confirmado directamente vía el Admin API (útil para scripts, no para probar el flujo de UI):

```bash
npx tsx -e "
import { createClient } from '@supabase/supabase-js';
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { data, error } = await admin.auth.admin.createUser({
  email: 'owner@example.com',
  password: 'password123',
  email_confirm: true,
});
console.log(error ?? data.user?.id);
"
```

## Comandos disponibles

| Comando | Qué hace |
|---|---|
| `npm run dev` | Levanta Next.js en modo desarrollo |
| `npm run build` | Build de producción |
| `npm run start` | Sirve el build de producción |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Pruebas unitarias (excluye la suite de RLS) |
| `npm run test:rls` | Suite de aislamiento de tenant — requiere `supabase start`, ver [17-rls-verification.md](17-rls-verification.md) |
| `npm run db:start` / `db:stop` | Levanta/detiene Supabase local |
| `npm run db:reset` | Recrea la base local desde cero (migraciones + seed) |
| `npm run db:diff` | Genera una migración a partir de cambios hechos en el Studio local (úsalo con cuidado — revisa siempre el SQL generado antes de commitear) |
| `npm run db:types` | Regenera `types/database.generated.ts` desde el esquema local real |

## Verificar RLS localmente

Ver [17-rls-verification.md](17-rls-verification.md) para la guía completa — requiere `SUPABASE_TEST_URL`/`SUPABASE_TEST_ANON_KEY`/`SUPABASE_TEST_SERVICE_ROLE_KEY` en `.env.local` apuntando a tu instancia local (nunca a staging/producción).

## Problemas comunes

| Síntoma | Causa probable |
|---|---|
| `Missing NEXT_PUBLIC_SUPABASE_URL...` al arrancar | Falta `.env.local` o no tiene las 3 variables completas |
| El build falla intentando prerenderizar una página protegida | No debería ocurrir — todas las rutas bajo `(protected)/`, `/onboarding` y `/select-tenant` declaran `export const dynamic = "force-dynamic"`. Si añades una página nueva que lee la sesión, agrega esa misma línea |
| `supabase start` no arranca | Docker Desktop no está corriendo, o el puerto 54321-54324/54329 está ocupado por otro proyecto Supabase local — revisa `supabase/config.toml` para los puertos configurados |
| Cambios en una migración ya aplicada no se reflejan | Las migraciones no se re-ejecutan automáticamente al editarlas — corre `npm run db:reset` |
