'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import type { IndexedPage } from '../app/search-index.json/route'

/**
 * Search across the docs and the site, opened from the header or with
 * Cmd+K, Ctrl+K or "/". The button shows "/" because it is the same key on
 * every platform, and naming Cmd or Ctrl would need a guess at the reader's
 * machine that the server cannot make.
 *
 * NO DEPENDENCY AND NO SERVICE. The index is a static file this build wrote
 * (app/search-index.json), fetched from this origin the first time search
 * opens, and matched here. Nothing a reader types leaves the browser.
 *
 * Every word must appear somewhere on a page for it to match. A title counts
 * most, a subheading next, the text least, and a match in a subheading links
 * straight to it.
 */

interface Hit {
  readonly page: IndexedPage
  readonly href: string
  readonly score: number
  readonly snippet: readonly [string, string, string] | null
}

let index: Promise<readonly IndexedPage[]> | undefined

function load(): Promise<readonly IndexedPage[]> {
  index ??= fetch('/search-index.json')
    .then((response) => {
      if (!response.ok) throw new Error(`search index: HTTP ${String(response.status)}`)
      return response.json() as Promise<{ pages: readonly IndexedPage[] }>
    })
    .then((data) => data.pages)
  return index
}

function occurrences(text: string, term: string, cap: number): number {
  let count = 0
  let from = text.indexOf(term)
  while (from !== -1 && count < cap) {
    count += 1
    from = text.indexOf(term, from + term.length)
  }
  return count
}

function snippetOf(text: string, term: string): readonly [string, string, string] | null {
  const at = text.toLowerCase().indexOf(term)
  if (at === -1) return null
  const start = Math.max(0, text.lastIndexOf(' ', Math.max(0, at - 70)))
  const endSpace = text.indexOf(' ', Math.min(text.length, at + term.length + 90))
  const end = endSpace === -1 ? text.length : endSpace
  return [
    `${start > 0 ? '... ' : ''}${text.slice(start, at).trimStart()}`,
    text.slice(at, at + term.length),
    `${text.slice(at + term.length, end)}${end < text.length ? ' ...' : ''}`,
  ]
}

function search(pages: readonly IndexedPage[], query: string): Hit[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 1)
  if (terms.length === 0) return []
  const hits: Hit[] = []
  for (const page of pages) {
    const title = page.t.toLowerCase()
    const text = page.x.toLowerCase()
    let score = 0
    let heading: readonly [string, string] | undefined
    let matchedAll = true
    for (const term of terms) {
      let s = 0
      if (title.includes(term)) s += title.startsWith(term) ? 14 : 9
      const sub = page.k.find(([name]) => name.toLowerCase().includes(term))
      if (sub !== undefined) {
        s += 5
        heading ??= sub
      }
      s += occurrences(text, term, 8)
      if (s === 0) {
        matchedAll = false
        break
      }
      score += s
    }
    if (!matchedAll) continue
    const titleMatched = terms.some((term) => title.includes(term))
    hits.push({
      page,
      href: heading !== undefined && !titleMatched ? `${page.h}#${heading[1]}` : page.h,
      score,
      snippet: snippetOf(page.x, terms.find((term) => text.includes(term)) ?? terms[0] ?? ''),
    })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 12)
}

const SUGGESTED: readonly { label: string; href: string }[] = [
  { label: 'Install', href: '/docs/install' },
  { label: 'Signing a transaction', href: '/docs/using/signing-a-transaction' },
  {
    label: 'The five things you can check',
    href: '/docs/verification/the-five-things-you-can-check',
  },
  { label: 'Threat model', href: '/docs/threat-model' },
]

export function Search() {
  const router = useRouter()
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [pages, setPages] = useState<readonly IndexedPage[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()

  const hits = useMemo(() => (pages === null ? [] : search(pages, query)), [pages, query])

  const open = useCallback(() => {
    const el = dialog.current
    if (el === null || el.open) return
    el.showModal()
    input.current?.select()
    load().then(
      (loaded) => {
        setPages(loaded)
      },
      () => {
        setFailed(true)
      }
    )
  }, [])

  const close = useCallback(() => {
    dialog.current?.close()
  }, [])

  const go = useCallback(
    (href: string) => {
      close()
      router.push(href)
    },
    [close, router]
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName))
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        open()
      } else if (event.key === '/' && !typing) {
        event.preventDefault()
        open()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const onInputKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => Math.min(i + 1, Math.max(0, hits.length - 1)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Enter') {
      const hit = hits[active]
      if (hit !== undefined) {
        event.preventDefault()
        go(hit.href)
      }
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label="Search the docs"
        className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[0.8125rem] text-muted hover:border-border hover:text-ink transition-colors"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="none">
          <circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.5" />
          <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="hidden md:inline">Search docs</span>
        <kbd className="hidden md:inline rounded border border-line px-1 font-mono text-[0.6875rem] text-muted">
          /
        </kbd>
      </button>

      <dialog
        ref={dialog}
        aria-label="Search"
        onClick={(event) => {
          // A click on the backdrop lands on the dialog itself.
          if (event.target === event.currentTarget) close()
        }}
        className="m-0 mx-auto mt-[8vh] w-[min(42rem,calc(100vw-2rem))] max-h-[80vh] overflow-hidden rounded-xl border border-border bg-surface p-0 text-body shadow-2xl backdrop:bg-black/55"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-4 shrink-0 text-muted"
            fill="none"
          >
            <circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="m10.5 10.5 3 3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <input
            ref={input}
            type="text"
            enterKeyHint="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={onInputKey}
            placeholder="Search the docs"
            aria-label="Search the docs"
            aria-controls={listId}
            aria-activedescendant={hits.length > 0 ? `${listId}-${String(active)}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="h-14 w-full bg-transparent text-[1rem] text-ink placeholder:text-muted outline-none focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={close}
            className="shrink-0 rounded-md border border-line px-2 py-1 font-mono text-[0.6875rem] text-muted hover:text-ink"
          >
            Esc
          </button>
        </div>

        <div className="max-h-[calc(80vh-3.5rem)] overflow-y-auto p-2">
          {failed ? (
            <p className="px-3 py-6 text-center text-[0.9375rem] text-muted">
              The search index did not load. Browse the docs from the sidebar instead.
            </p>
          ) : query.trim().length < 2 ? (
            <div className="px-2 py-3">
              <p className="label px-1">Suggested</p>
              <ul className="mt-2">
                {SUGGESTED.map((item) => (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      onClick={(event) => {
                        event.preventDefault()
                        go(item.href)
                      }}
                      className="block rounded-md px-3 py-2 text-[0.9375rem] text-ink hover:bg-sunk"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : pages === null ? (
            <p className="px-3 py-6 text-center text-[0.9375rem] text-muted">Loading the index</p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-6 text-center text-[0.9375rem] text-muted">
              Nothing matches &ldquo;{query.trim()}&rdquo;.
            </p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Results">
              {hits.map((hit, i) => (
                <li
                  key={hit.href}
                  id={`${listId}-${String(i)}`}
                  role="option"
                  aria-selected={i === active}
                >
                  <a
                    href={hit.href}
                    onClick={(event) => {
                      event.preventDefault()
                      go(hit.href)
                    }}
                    onMouseEnter={() => {
                      setActive(i)
                    }}
                    className={`block rounded-lg px-3 py-2.5 ${i === active ? 'bg-sunk' : ''}`}
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold text-ink leading-snug">{hit.page.t}</span>
                      <span className="shrink-0 text-[0.75rem] text-muted">{hit.page.c}</span>
                    </span>
                    {hit.snippet === null ? null : (
                      <span className="mt-1 block text-[0.8125rem] leading-snug text-muted line-clamp-2">
                        {hit.snippet[0]}
                        <mark className="bg-transparent font-semibold text-ink">
                          {hit.snippet[1]}
                        </mark>
                        {hit.snippet[2]}
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </dialog>
    </>
  )
}
