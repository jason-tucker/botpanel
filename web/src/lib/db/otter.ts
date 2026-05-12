import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env'
import * as schema from './schema/otter'

/**
 * Drizzle client for Otterbot's Postgres.
 *
 * OTTER_DATABASE_URL is optional in the env schema so the dashboard can boot
 * for read-only / auth-only flows before DB wiring is in place. We make the
 * client *lazy*: simply importing this module never opens a connection, and
 * any property access on `otterDb` without the URL throws a clear error
 * pointing the operator at the missing env var.
 */

type OtterDb = ReturnType<typeof drizzle<typeof schema>>

let _client: ReturnType<typeof postgres> | null = null
let _db: OtterDb | null = null

function getDb(): OtterDb {
  if (_db) return _db
  if (!env.OTTER_DATABASE_URL) {
    throw new Error(
      'OTTER_DATABASE_URL is required to use otterDb — set it in the panel env',
    )
  }
  _client = postgres(env.OTTER_DATABASE_URL, { max: 5, idle_timeout: 30 })
  _db = drizzle(_client, { schema })
  return _db
}

export const otterDb = new Proxy({} as OtterDb, {
  get(_t, prop) {
    const db = getDb() as unknown as Record<string | symbol, unknown>
    return db[prop as string]
  },
})

export { schema as otterSchema }
