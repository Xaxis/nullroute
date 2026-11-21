/**
 * The project at a glance, read from public sources only: GitHub's API for the repository, the live
 * site, and DNS over HTTPS for the records mail and this console depend on. Each source is cached
 * for five minutes and fails on its own, so one slow answer never blanks the page.
 */
import { createHash } from 'node:crypto'
import { env } from './env'

export const REPO = 'Xaxis/nullroute'
const GH = `https://api.github.com/repos/${REPO}`
const CACHE = { next: { revalidate: 300 } }

export type Fetched<T> = { ok: true; value: T } | { ok: false; reason: string }

async function get<T>(url: string, init: RequestInit = {}): Promise<Fetched<T>> {
  try {
    const res = await fetch(url, { ...CACHE, ...init, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return { ok: false, reason: `${new URL(url).host} answered ${String(res.status)}` }
    return { ok: true, value: (await res.json()) as T }
  } catch (e) {
    return {
      ok: false,
      reason: `${new URL(url).host} did not answer (${e instanceof Error ? e.name : 'error'})`,
    }
  }
}

function gh<T>(path: string): Promise<Fetched<T>> {
  const token = env().GITHUB_TOKEN
  return get<T>(`${GH}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  })
}

export interface Commit {
  sha: string
  message: string
  date: string
  url: string
}

export interface Run {
  name: string
  status: string
  conclusion: string | null
  sha: string
  url: string
  updated: string
}

export interface Artifact {
  name: string
  expires: string
  expired: boolean
}

export async function latestCommit(): Promise<Fetched<Commit>> {
  const r = await gh<{
    sha: string
    html_url: string
    commit: { message: string; committer: { date: string } }
  }>('/commits/main')
  if (!r.ok) return r
  return {
    ok: true,
    value: {
      sha: r.value.sha,
      message: r.value.commit.message.split('\n')[0] ?? '',
      date: r.value.commit.committer.date,
      url: r.value.html_url,
    },
  }
}

/** The newest run of each workflow on main. */
export async function latestRuns(): Promise<Fetched<Run[]>> {
  const r = await gh<{
    workflow_runs: {
      name: string
      status: string
      conclusion: string | null
      head_sha: string
      html_url: string
      updated_at: string
      event: string
    }[]
  }>('/actions/runs?branch=main&per_page=30')
  if (!r.ok) return r
  const seen = new Map<string, Run>()
  for (const w of r.value.workflow_runs) {
    if (w.event === 'dynamic' || seen.has(w.name)) continue
    seen.set(w.name, {
      name: w.name,
      status: w.status,
      conclusion: w.conclusion,
      sha: w.head_sha,
      url: w.html_url,
      updated: w.updated_at,
    })
  }
  return { ok: true, value: [...seen.values()] }
}

export async function cardArtifact(): Promise<Fetched<Artifact | null>> {
  const r = await gh<{ artifacts: { name: string; expires_at: string; expired: boolean }[] }>(
    '/actions/artifacts?per_page=20'
  )
  if (!r.ok) return r
  const card = r.value.artifacts.find((a) => a.name.startsWith('nullroute-card-UNSIGNED-'))
  return {
    ok: true,
    value: card ? { name: card.name, expires: card.expires_at, expired: card.expired } : null,
  }
}

export async function openWork(): Promise<Fetched<{ pulls: number; issues: number }>> {
  const r = await gh<{ open_issues_count: number }>('')
  const p = await gh<unknown[]>('/pulls?state=open&per_page=100')
  if (!r.ok) return r
  if (!p.ok) return p
  // GitHub counts open pull requests among open issues.
  return {
    ok: true,
    value: { pulls: p.value.length, issues: r.value.open_issues_count - p.value.length },
  }
}

/** SHA-256 of MANIFEST.lock on main: the manifest root the device shows. */
export async function manifestRoot(): Promise<Fetched<string>> {
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${REPO}/main/MANIFEST.lock`, {
      ...CACHE,
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok)
      return { ok: false, reason: `raw.githubusercontent.com answered ${String(res.status)}` }
    const bytes = Buffer.from(await res.arrayBuffer())
    return { ok: true, value: createHash('sha256').update(bytes).digest('hex') }
  } catch (e) {
    return {
      ok: false,
      reason: `raw.githubusercontent.com did not answer (${e instanceof Error ? e.name : 'error'})`,
    }
  }
}

export async function siteUp(): Promise<Fetched<number>> {
  try {
    const res = await fetch('https://nullroute.diy/', {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    return { ok: true, value: res.status }
  } catch (e) {
    return {
      ok: false,
      reason: `nullroute.diy did not answer (${e instanceof Error ? e.name : 'error'})`,
    }
  }
}

export interface DnsCheck {
  label: string
  /** The host as Namecheap's Advanced DNS wants it, relative to nullroute.diy. */
  host: string
  type: 'TXT' | 'MX' | 'CNAME'
  /** The whole value to enter. */
  value: string
  /** Matched as a substring of an answer: DNS may quote, split or add a trailing dot. */
  want: string
  found: string[]
  ok: boolean
}

const DKIM =
  'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDJoxnsoiOx3RjjoumcgUf0CBi45gNZVxlzfUWKM6RbAUoK/yOM9S7nTgV6zqcrYpXRoFbqXa1pxe0IYJrC01/u4V6MNfhUxVgws7TYywk45c0QNQn33OVG3O+6Jutuz5orODY3sGIWmPiDJWU8PdWwjy+ha0yMhFoPcF706XPqpwIDAQAB'

/**
 * The records Resend needs for nullroute.diy (Xaxis team, domain recreated 21 November 2026), as
 * its API listed them. Resend's dashboard is the source if they ever change. The console needs
 * none of its own: it is served at nullroute.diy/admin.
 */
const RECORDS: Omit<DnsCheck, 'found' | 'ok'>[] = [
  {
    label: 'Resend DKIM',
    host: 'resend._domainkey',
    type: 'TXT',
    value: DKIM,
    want: DKIM.slice(0, 60),
  },
  {
    label: 'Resend SPF (send)',
    host: 'send',
    type: 'CNAME',
    value: 'send.forge.rmta.net',
    want: 'send.forge.rmta.net',
  },
  {
    label: 'Resend SPF (rsend)',
    host: 'rsend',
    type: 'CNAME',
    value: 'rsend.forge.rmta.net',
    want: 'rsend.forge.rmta.net',
  },
]

export async function dnsChecks(): Promise<DnsCheck[]> {
  return Promise.all(
    RECORDS.map(async (r) => {
      const name = `${r.host}.nullroute.diy`
      const res = await get<{ Answer?: { data: string }[] }>(
        `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${r.type}`,
        { next: { revalidate: 120 } }
      )
      // A long TXT record comes back as quoted pieces; joined, it is the value that was entered.
      const found = res.ok
        ? (res.value.Answer ?? []).map((a) => a.data.replace(/"\s*"/g, '').replaceAll('"', ''))
        : []
      return { ...r, found, ok: found.some((f) => f.includes(r.want)) }
    })
  )
}
