/**
 * Server configuration, parsed once. Anything missing fails loudly on first use with the
 * variable's name, never later with an undefined deep inside a request.
 */
import { z } from 'zod'

const split = (s: string): string[] =>
  s
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)

const schema = z.object({
  /**
   * The origin the console is served on: https://nullroute.diy, under /admin (src/base-path.ts).
   * Sign-in requests and server actions must come from it, and emails link to it.
   */
  PUBLIC_ORIGIN: z.url(),
  /** Who may sign in. Nobody else gets a code, and a removed address loses its sessions. */
  OWNER_EMAILS: z
    .string()
    .transform((s) => split(s).map((e) => e.toLowerCase()))
    .pipe(z.array(z.email()).min(1)),
  CODE_SECRET: z.string().min(32),
  CRON_SECRET: z.string().min(16),
  DATABASE_URL: z.string().startsWith('postgres'),
  RESEND_API_KEY: z.string().startsWith('re_'),
  /** Sign-in codes come from here: signin@nullroute.diy. */
  MAIL_FROM: z.string().min(3),
  /** Contact-form notifications come from here, and go to CONTACT_TO. */
  CONTACT_FROM: z.string().min(3),
  CONTACT_TO: z.email(),
  /** The public site's origins, the only pages allowed to post the contact form. */
  SITE_ORIGINS: z.string().transform(split).pipe(z.array(z.url()).min(1)),
  /** Optional: raises GitHub's limit for the overview from 60 to 5000 requests an hour. */
  GITHUB_TOKEN: z.string().optional(),
})

export type Env = z.infer<typeof schema>

let cached: Env | undefined

export function env(): Env {
  if (cached) return cached
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
    throw new Error(`nullroute admin is missing or has invalid settings: ${names}`)
  }
  cached = parsed.data
  return cached
}
