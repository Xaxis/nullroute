'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

/**
 * A copy button on every code block in a docs page.
 *
 * ADDED AFTER LOAD, NOT RENDERED. The docs are repository Markdown rendered at
 * build time, and a button that does nothing without JavaScript should not be
 * in the page for a reader who has none. This finds each block once the page
 * is up and wraps it, so the block itself is untouched.
 */
export function CopyCode() {
  const path = usePathname()
  useEffect(() => {
    for (const pre of document.querySelectorAll<HTMLPreElement>('.prose-doc pre')) {
      if (pre.parentElement?.classList.contains('code-wrap') === true) continue
      const wrap = document.createElement('div')
      wrap.className = 'code-wrap'
      pre.replaceWith(wrap)
      wrap.append(pre)
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'code-copy'
      button.textContent = 'Copy'
      button.addEventListener('click', () => {
        navigator.clipboard.writeText(pre.innerText.trimEnd()).then(
          () => {
            button.textContent = 'Copied'
            setTimeout(() => {
              button.textContent = 'Copy'
            }, 1600)
          },
          () => {
            button.textContent = 'Select and copy'
          }
        )
      })
      wrap.append(button)
    }
  }, [path])
  return null
}
