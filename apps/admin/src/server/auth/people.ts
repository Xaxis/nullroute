/** Parsing and handling of the identifying bits of a request: email, code, client IP. */

export type Email = string & { readonly __email: unique symbol }

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[a-z]{2,63}$/i

/** A trimmed, lowercased email address, or undefined if it isn't one. */
export function parseEmail(input: unknown): Email | undefined {
  if (typeof input !== 'string') return undefined
  const e = input.trim().toLowerCase()
  return e.length <= 320 && EMAIL.test(e) ? (e as Email) : undefined
}

export function parseCode(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const c = input.replace(/\s+/g, '')
  return /^\d{6}$/.test(c) ? c : undefined
}

/** "william@example.com" becomes "w•••m@example.com": enough to recognise, not enough to harvest. */
export function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@')
  const first = user.at(0) ?? ''
  const shown = user.length <= 2 ? `${first}•••` : `${first}•••${user.at(-1) ?? ''}`
  return `${shown}@${domain}`
}

/**
 * The client's IP. On Vercel `x-real-ip` is set by the edge and can't be forged by the client;
 * `x-forwarded-for` can, so it is only a local-dev fallback.
 */
export function clientIp(headers: Headers): string {
  const candidates = [headers.get('x-real-ip'), headers.get('x-forwarded-for')?.split(',')[0]]
  // An empty header is as good as none.
  return candidates.map((c) => c?.trim()).find((c) => c !== undefined && c !== '') ?? 'local'
}

/** IPv4 /24 or IPv6 /48: what gets stored and rate limited, never the full address. */
export function ipPrefix(raw: string): string {
  const ip = raw.trim().replace(/%.*$/, '')
  // An IPv4 client reported in IPv6 form is still that IPv4 client, and must share its key.
  const v4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip)?.[1] ?? (isIPv4(ip) ? ip : undefined)
  if (v4) return `${v4.split('.').slice(0, 3).join('.')}.0/24`
  const groups = expandIPv6(ip)
  if (groups) return `${groups.slice(0, 3).join(':')}::/48`
  return ip
}

function isIPv4(ip: string): boolean {
  const parts = ip.split('.')
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

/**
 * The eight groups of an IPv6 address, without leading zeros, or undefined when it is not one.
 * Expanded before anything is sliced off: `2001:db8::5` and `2001:db8:0:1::5` are in the same
 * /48, and taking the first three groups of each as written would give them different keys.
 */
export function expandIPv6(ip: string): string[] | undefined {
  const halves = ip.split('::')
  if (halves.length > 2) return undefined
  const side = (s: string | undefined): string[] | undefined => {
    if (s === undefined || s === '') return []
    const out: string[] = []
    const parts = s.split(':')
    for (const [i, p] of parts.entries()) {
      // A dotted quad may end the address (64:ff9b::192.0.2.1), and stands for two groups.
      if (i === parts.length - 1 && isIPv4(p)) {
        const [a = 0, b = 0, c = 0, d = 0] = p.split('.').map(Number)
        out.push(((a << 8) | b).toString(16), ((c << 8) | d).toString(16))
      } else if (/^[0-9a-f]{1,4}$/i.test(p)) out.push(parseInt(p, 16).toString(16))
      else return undefined
    }
    return out
  }
  const head = side(halves[0])
  const tail = side(halves[1])
  if (!head || !tail) return undefined
  if (halves.length === 1) return head.length === 8 ? head : undefined
  const fill = 8 - head.length - tail.length
  if (fill < 1) return undefined
  return [...head, ...Array<string>(fill).fill('0'), ...tail]
}

export function browserName(ua: string | null): string {
  if (!ua) return 'Unknown browser'
  const browser = ua.includes('Edg/')
    ? 'Edge'
    : ua.includes('Firefox/')
      ? 'Firefox'
      : ua.includes('Chrome/')
        ? 'Chrome'
        : ua.includes('Safari/')
          ? 'Safari'
          : 'Browser'
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : ua.includes('Android')
      ? 'Android'
      : ua.includes('Mac OS X')
        ? 'macOS'
        : ua.includes('Windows')
          ? 'Windows'
          : ua.includes('Linux')
            ? 'Linux'
            : ''
  return os ? `${browser} on ${os}` : browser
}
