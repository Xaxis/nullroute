import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeSlug from 'rehype-slug'
import rehypeStringify from 'rehype-stringify'
import { visit } from 'unist-util-visit'
import type { Root, Element } from 'hast'

/**
 * Wrap every table in a scroll container.
 *
 * The threat model and the interop matrix are wide tables, and a table that
 * cannot scroll inside its own box pushes the entire page sideways on a phone.
 * That failure looks fine on a laptop and makes the docs unusable on the device
 * most people will read them on.
 */
function rehypeScrollableTables() {
  return (tree: Root): void => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'table' || parent === undefined || index === undefined) return
      const wrapper: Element = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['table-scroll'] },
        children: [node],
      }
      parent.children[index] = wrapper
    })
  }
}

/** Rewrite in-repo links so docs cross-references resolve on the site. */
function rehypeRepoLinks() {
  return (tree: Root): void => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return
      const href = node.properties.href
      if (typeof href !== 'string') return

      // docs/FOO.md and ../SECURITY.md style links become site routes.
      const docMatch = /^(?:\.\.\/)?(?:docs\/)?([A-Z][A-Z0-9-]*)\.md(#.*)?$/.exec(href)
      if (docMatch) {
        const [, name, fragment] = docMatch
        node.properties.href = `/docs/${(name ?? '').toLowerCase()}${fragment ?? ''}`
        return
      }
      if (href.startsWith('http')) {
        node.properties.target = '_blank'
        node.properties.rel = 'noopener noreferrer'
      }
    })
  }
}

export async function renderMarkdown(source: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeScrollableTables)
    .use(rehypeRepoLinks)
    .use(rehypeStringify)
    .process(source)
  return String(file)
}

/** Headings for an on-page table of contents. */
export function extractHeadings(source: string): { depth: number; text: string; id: string }[] {
  const headings: { depth: number; text: string; id: string }[] = []
  for (const line of source.split('\n')) {
    const match = /^(#{2,3})\s+(.+)$/.exec(line)
    if (!match) continue
    const [, hashes, rawText] = match
    if (hashes === undefined || rawText === undefined) continue
    const text = rawText.replace(/[*`_]/g, '').trim()
    const id = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
    headings.push({ depth: hashes.length, text, id })
  }
  return headings
}
