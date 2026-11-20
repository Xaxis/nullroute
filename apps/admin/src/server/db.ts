import pgLib from 'pg'
import { env } from './env'
import { createSql, type Sql } from './sql'
import { SUPABASE_ROOT_CA } from './supabase-ca'

declare global {
  // Reused across hot reloads in dev and across invocations of a warm function.
  var __nullroutePool: pgLib.Pool | undefined
  var __nullrouteSql: Sql | undefined
}

// Scoped to this pool, so pg's global defaults stay as they are.
const types = new pgLib.TypeOverrides()
// Counts come back as numbers (bigint values here stay far below 2^53).
types.setTypeParser(pgLib.types.builtins.INT8, Number)
// Dates stay strings: a `date` column is a calendar day, not an instant, and a Date object would
// move it by the server's time zone.
types.setTypeParser(pgLib.types.builtins.DATE, (v: string) => v)

function pool(): pgLib.Pool {
  globalThis.__nullroutePool ??= new pgLib.Pool({
    // Supabase's transaction pooler (port 6543): many short-lived clients share a few database
    // connections, which is what serverless functions need. A local URL has no TLS; any other
    // must present a certificate that chains to Supabase's root and names the host.
    connectionString: env().DATABASE_URL,
    ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(env().DATABASE_URL)
      ? false
      : { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true },
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'nullroute-admin',
    types,
  })
  return globalThis.__nullroutePool
}

/** Tagged-template SQL over the pool (sql.ts). */
export function pg(): Sql {
  globalThis.__nullrouteSql ??= createSql(pool())
  return globalThis.__nullrouteSql
}
