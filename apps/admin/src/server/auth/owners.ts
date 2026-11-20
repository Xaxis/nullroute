/** Who may sign in: the addresses in OWNER_EMAILS, and nobody else. */
import { env } from '../env'

export function isOwner(email: string): boolean {
  return env().OWNER_EMAILS.includes(email.toLowerCase())
}
