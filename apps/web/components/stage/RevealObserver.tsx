'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'

/**
 * Starts each `.reveal` or `.reveal-rows` element's entrance when it first
 * scrolls into view.
 *
 * PROGRESSIVE, SO NOTHING CAN BE LEFT HIDDEN. The page is fully visible as
 * served. Only after this runs does `motion` go on <html>, which is what lets
 * the stylesheet hide what is still below the fold. On the first page load,
 * whatever is already on screen is marked shown without animating, so nothing
 * the reader is looking at blinks out and back. With scripts off, or with
 * prefers-reduced-motion set, this does nothing and nothing moves.
 *
 * RUNS AGAIN ON EVERY ROUTE. It lives in the layout, which a link between
 * pages does not remount, so it keys on the path: without that, a page
 * reached by a link arrived with `motion` already set and nothing watching
 * its sections, and everything below the fold stayed hidden. After a
 * navigation the new page was never painted visible, so what is on screen
 * animates in rather than being marked still.
 *
 * A scroll-driven animation would need no script, but it ties progress to
 * scroll position, and a page opened with the hash band half in view showed
 * its tiles stuck half flipped.
 */
export function RevealObserver() {
  const path = usePathname()
  const loaded = useRef(false)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (!('IntersectionObserver' in window)) return
    const first = !loaded.current
    loaded.current = true
    const items = Array.from(
      document.querySelectorAll<HTMLElement>('.reveal:not(.is-in), .reveal-rows:not(.is-in)')
    )
    if (first) {
      const fold = window.innerHeight
      for (const el of items) {
        const box = el.getBoundingClientRect()
        if (box.top < fold && box.bottom > 0) el.classList.add('is-in', 'is-still')
      }
    }
    document.documentElement.classList.add('motion')
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-in')
          observer.unobserve(entry.target)
        }
      },
      // Any part of it past 88% of the viewport's height. A fractional
      // threshold would never be reached by an element taller than the
      // viewport divided by that fraction, which would then stay hidden.
      { rootMargin: '0px 0px -12% 0px', threshold: 0 }
    )
    for (const el of items) if (!el.classList.contains('is-in')) observer.observe(el)
    return () => {
      observer.disconnect()
    }
  }, [path])
  return null
}
