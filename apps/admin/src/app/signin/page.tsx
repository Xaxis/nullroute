import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Mark } from '@/components/Mark'
import { getViewer } from '@/server/auth/viewer'
import { SignInForm } from './SignInForm'

export const metadata: Metadata = { title: 'Sign in' }
export const dynamic = 'force-dynamic'

function safeNext(next: string | string[] | undefined): string {
  const n = Array.isArray(next) ? next[0] : next
  // Only same-origin paths: never "//evil.com" or "https://...".
  return n?.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/'
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>
}) {
  const next = safeNext((await searchParams).next)
  if (await getViewer()) redirect(next)
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center justify-center gap-2 text-ink">
          <Mark className="size-6 text-signal" />
          <span className="font-mono text-[1.0625rem] font-medium">nullroute</span>
        </div>
        <SignInForm next={next} />
        <p className="mt-6 text-center text-[0.8125rem] text-muted">
          The maintainer&apos;s console. The public site is{' '}
          <a href="https://nullroute.diy" className="text-link hover:text-link-hover">
            nullroute.diy
          </a>
          .
        </p>
      </div>
    </main>
  )
}
