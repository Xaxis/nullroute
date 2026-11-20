// From Admission apps/admission/src/server/db/sql.ts @ d7d940d (see UPSTREAM.md).
/**
 * A tagged-template SQL helper over node-postgres. It keeps the small part of the postgres.js API
 * the app was written against (sql`…${value}…`, nested fragments, sql(rows) for VALUES lists,
 * sql.json, sql.begin, result.count) while sending one query at a time per connection, which is
 * what Supabase's transaction pooler needs: postgres.js's pipelining hangs behind it.
 */
import type { Pool, PoolClient, QueryResult } from 'pg'

type Runner = Pick<PoolClient, 'query'>

export type Rows<T> = T & { count: number }

/** A query that runs when awaited, or inlines into another query when interpolated. */
export class Query<T> implements PromiseLike<Rows<T>> {
  constructor(
    private readonly run: Runner,
    readonly strings: readonly string[],
    readonly values: readonly unknown[]
  ) {}

  // Being awaitable is the point: `await sql\`…\`` runs the query.
  then<A = Rows<T>, B = never>(
    onFulfilled?: ((value: Rows<T>) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    return this.execute().then(onFulfilled, onRejected)
  }

  private async execute(): Promise<Rows<T>> {
    const { text, params } = compile(this)
    const res: QueryResult = await this.run.query({ text, values: params })
    const rows = res.rows as unknown as Rows<T>
    rows.count = res.rowCount ?? res.rows.length
    return rows
  }
}

class ValuesList {
  constructor(
    readonly rows: readonly Record<string, unknown>[],
    readonly columns: readonly string[]
  ) {}
}

class JsonValue {
  constructor(readonly value: unknown) {}
}

export function compile(q: { strings: readonly string[]; values: readonly unknown[] }) {
  const params: unknown[] = []
  const add = (v: unknown) => {
    params.push(v instanceof JsonValue ? JSON.stringify(v.value) : v)
    return `$${String(params.length)}`
  }
  const walk = (strings: readonly string[], values: readonly unknown[]): string => {
    let out = strings[0] ?? ''
    values.forEach((v, i) => {
      if (v instanceof Query) out += walk(v.strings, v.values)
      else if (v instanceof ValuesList) {
        const cols = v.columns
        out += `(${cols.map((c) => `"${c}"`).join(', ')}) values ${v.rows
          .map((r) => `(${cols.map((c) => add(r[c] === undefined ? null : r[c])).join(', ')})`)
          .join(', ')}`
      } else out += add(v)
      out += strings[i + 1] ?? ''
    })
    return out
  }
  return { text: walk(q.strings, q.values), params }
}

export interface Sql {
  <T extends readonly object[] = Record<string, unknown>[]>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Query<T>
  /** A VALUES list for an insert: (col, …) values ($1, …), …. Columns come from the first row unless named. */
  (rows: readonly object[], ...columns: string[]): ValuesList
  json(value: unknown): JsonValue
  begin<R>(fn: (tx: Sql) => Promise<R>): Promise<R>
}

function bind(run: Runner, pool: Pool | null): Sql {
  const sql = ((first: TemplateStringsArray | readonly object[], ...rest: unknown[]) => {
    if (Array.isArray(first) && 'raw' in first)
      return new Query(run, first as TemplateStringsArray, rest)
    const rows = first as readonly Record<string, unknown>[]
    const columns = rest.length ? (rest as string[]) : Object.keys(rows[0] ?? {})
    if (!rows.length) throw new Error('sql(rows) needs at least one row')
    return new ValuesList(rows, columns)
  }) as Sql
  sql.json = (value) => new JsonValue(value)
  sql.begin = async (fn) => {
    if (!pool) throw new Error("Nested transactions aren't supported")
    const client = await pool.connect()
    let broken = false
    try {
      await client.query('begin')
      const out = await fn(bind(client, null))
      await client.query('commit')
      return out
    } catch (e) {
      // The error worth reporting is `e`. If the rollback fails as well, the connection is in an
      // unknown state, so it is destroyed below rather than handed to the next request.
      await client.query('rollback').catch(() => {
        broken = true
      })
      throw e
    } finally {
      client.release(broken)
    }
  }
  return sql
}

export function createSql(pool: Pool): Sql {
  return bind(pool, pool)
}
