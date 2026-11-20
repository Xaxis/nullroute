import { pg } from './db'

export interface AuditEntry {
  actor: string | null
  action: string
  detail?: Record<string, unknown>
}

/** Records who did what. Never throws: an audit failure must not block the action it describes. */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await pg()`
      insert into nullroute.audit_log (actor, action, detail)
      values (${entry.actor}, ${entry.action}, ${entry.detail ? pg().json(entry.detail) : null})`
  } catch (e) {
    console.error('audit failed', entry.action, e instanceof Error ? e.message : e)
  }
}
