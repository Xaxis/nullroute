import type { ReactNode } from 'react'
import { BASE_PATH } from '@/base-path'
import { Mark } from './Mark'
import { Nav, type NavItem } from './Nav'

function SignOut() {
  return (
    <form action={`${BASE_PATH}/api/auth/signout`} method="post">
      <button
        type="submit"
        className="text-[0.8125rem] text-muted underline-offset-4 hover:text-ink hover:underline"
      >
        Sign out
      </button>
    </form>
  )
}

function Brand() {
  return (
    <a href={BASE_PATH} className="flex items-center gap-2 text-ink">
      <Mark className="size-5 text-signal" />
      <span className="font-mono text-[0.9375rem] font-medium">nullroute</span>
      <span className="rounded border border-border px-1.5 text-[0.6875rem] leading-[1.125rem] tracking-wide text-muted uppercase">
        admin
      </span>
    </a>
  )
}

export function Shell({
  email,
  items,
  children,
}: {
  email: string
  items: NavItem[]
  children: ReactNode
}) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden border-r border-line bg-surface lg:flex lg:min-h-dvh lg:flex-col lg:px-4 lg:py-5">
        <div className="px-3">
          <Brand />
        </div>
        <div className="mt-8 flex-1">
          <Nav items={items} layout="side" />
        </div>
        <div className="space-y-2 border-t border-line px-3 pt-4">
          <a
            href="https://nullroute.diy"
            className="block text-[0.8125rem] text-muted hover:text-ink"
          >
            nullroute.diy
          </a>
          <div className="truncate text-[0.8125rem] text-body" title={email}>
            {email}
          </div>
          <SignOut />
        </div>
      </aside>
      <div className="border-b border-line bg-surface px-4 py-3 lg:hidden">
        <div className="flex items-center justify-between">
          <Brand />
          <SignOut />
        </div>
        <div className="mt-3">
          <Nav items={items} layout="top" />
        </div>
      </div>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 lg:py-10">{children}</main>
    </div>
  )
}
