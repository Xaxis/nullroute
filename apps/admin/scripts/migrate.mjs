// Applies db/migrations/*.sql in name order, each once and in its own
// transaction, then locks the schema away from Supabase's API roles (they exist
// only on Supabase; elsewhere that step is skipped). Plain SQL rather than an
// ORM's migrator: the schema is small and the files are the record.
//
// Run: npm run migrate   (reads DATABASE_URL from apps/admin/.env)

import { readdirSync, readFileSync } from 'node:fs'
import pg from 'pg'
// Node 24 runs TypeScript by stripping types, so the console and this script pin the same root.
import { SUPABASE_ROOT_CA } from '../src/server/supabase-ca.ts'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')
const dir = new URL('../db/migrations/', import.meta.url)
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url)
const client = new pg.Client({
  connectionString: url,
  ssl: local ? false : { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true },
})

await client.connect()
try {
  await client.query('set client_min_messages = warning')
  await client.query(`create schema if not exists nullroute;
    create table if not exists nullroute.schema_migrations (
      name text primary key, applied_at timestamptz not null default now())`)
  const done = new Set(
    (await client.query('select name from nullroute.schema_migrations')).rows.map((r) => r.name)
  )
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (const name of files) {
    if (done.has(name)) continue
    const sql = readFileSync(new URL(name, dir), 'utf8')
    await client.query('begin')
    try {
      await client.query(sql)
      await client.query('insert into nullroute.schema_migrations (name) values ($1)', [name])
      await client.query('commit')
      console.log(`applied ${name}`)
    } catch (e) {
      await client.query('rollback')
      throw e
    }
  }
  const roles = await client.query(
    "select count(*)::int as n from pg_roles where rolname in ('anon', 'authenticated')"
  )
  if (roles.rows[0].n === 2) {
    // Supabase grants its API roles broad defaults; nothing in this schema is for them.
    await client.query(`
      revoke all on schema nullroute from anon, authenticated;
      revoke all on all tables in schema nullroute from anon, authenticated;
      revoke all on all sequences in schema nullroute from anon, authenticated;
      alter default privileges in schema nullroute revoke all on tables from anon, authenticated;
      alter default privileges in schema nullroute revoke all on sequences from anon, authenticated;
    `)
  }
  const tables = await client.query(
    "select count(*)::int as n from information_schema.tables where table_schema = 'nullroute'"
  )
  console.log(`nullroute schema: ${tables.rows[0].n} tables, ${files.length} migration file(s)`)
} finally {
  await client.end()
}
