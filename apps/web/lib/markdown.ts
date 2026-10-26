import { posix } from 'node:path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeSlug from 'rehype-slug'
import rehypeStringify from 'rehype-stringify'
import { visit } from 'unist-util-visit'
import type { Root, Element, ElementContent } from 'hast'
import { repoBlobUrl } from './site'

/**
 * Markdown from the repository, rendered at build time.
 *
 * The same files a reviewer reads in the source are the ones this site
 * renders, so the page and the file cannot say different things. Nothing here
 * runs at request time and no input comes from a visitor.
 */

/**
 * Wrap every table so it scrolls inside its own box. The threat model and the
 * profile carry wide tables, and a table wider than a phone used to push the
 * whole document sideways.
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

/**
 * Point every relative link at the page that renders its target, or at the
 * file on GitHub when no page does.
 *
 * RESOLVED AGAINST THE FILE THE LINK IS IN. This used to assume every rendered
 * file lived in docs/, which was true until the site rendered SECURITY.md and
 * the signer profile: `docs/THREAT-MODEL.md` written in a root file and
 * `../conformance/README.md` written in spec/ are both right on GitHub, and
 * both were wrong here. Resolving the path the way GitHub does is the only
 * rule that keeps a link correct in both places.
 */
function rehypeRepoLinks(fromFile: string, published: ReadonlyMap<string, string>) {
  const dir = posix.dirname(fromFile)
  return (tree: Root): void => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return
      const href = node.properties.href
      if (typeof href !== 'string') return

      if (/^https?:/.test(href)) {
        node.properties.target = '_blank'
        node.properties.rel = ['noopener', 'noreferrer']
        return
      }
      if (href.startsWith('#') || href.startsWith('mailto:')) return

      const [path = '', fragment] = href.split('#', 2)
      const resolved = posix.normalize(posix.join(dir, path)).replace(/\/$/, '')
      if (resolved.startsWith('..')) return
      const page = published.get(resolved)
      const hash = fragment === undefined ? '' : `#${fragment}`
      if (page !== undefined) {
        node.properties.href = `${page}${hash}`
        return
      }
      node.properties.href = `${repoBlobUrl(resolved)}${hash}`
      node.properties.target = '_blank'
      node.properties.rel = ['noopener', 'noreferrer']
    })
  }
}

/** The text of a hast node and its children. */
function textOf(node: ElementContent): string {
  if (node.type === 'text') return node.value
  if (node.type === 'element') return node.children.map(textOf).join('')
  return ''
}

const REQUIREMENT = /^(SP-[A-Z]+-\d+)\.$/
const REQUIREMENT_ID = /^SP-[A-Z]+-\d+$/

/**
 * Give each requirement in the signer profile an anchor, and link every bare
 * requirement id in its tables to that anchor.
 *
 * A profile is argued about requirement by requirement, and "see SP-REV-9" is
 * only useful if it can be a link. The paragraph that opens with
 * **SP-REV-9.** gets the id `sp-rev-9`; a table cell holding only `SP-REV-9`
 * becomes a link to it.
 */
function rehypeRequirementAnchors() {
  return (tree: Root): void => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName === 'p') {
        const first = node.children[0]
        if (first?.type === 'element' && first.tagName === 'strong') {
          const match = REQUIREMENT.exec(textOf(first).trim())
          if (match !== null) {
            node.properties.id = (match[1] ?? '').toLowerCase()
            node.properties.className = ['req']
          }
        }
      }
      // The first cell of a row only. An id in a later column is a reference
      // inside a wide table, and a link there is a link the reader has to
      // scroll sideways to find on a phone.
      if (node.tagName === 'tr') {
        const first = node.children.find((c) => c.type === 'element')
        if (first?.type === 'element' && first.tagName === 'td') first.properties.dataFirst = 'true'
      }
      if (node.tagName === 'td' && node.properties.dataFirst === 'true') {
        delete node.properties.dataFirst
        const only = node.children.length === 1 ? node.children[0] : undefined
        if (only?.type === 'text' && REQUIREMENT_ID.test(only.value.trim())) {
          const id = only.value.trim()
          node.children = [
            {
              type: 'element',
              tagName: 'a',
              properties: { href: `#${id.toLowerCase()}` },
              children: [{ type: 'text', value: id }],
            },
          ]
        }
      }
    })
  }
}

export async function renderMarkdown(
  source: string,
  fromFile: string,
  published: ReadonlyMap<string, string>,
  options: { requirements?: boolean } = {}
): Promise<string> {
  const pipeline = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeScrollableTables)
    .use(rehypeRepoLinks, fromFile, published)
  if (options.requirements === true) pipeline.use(rehypeRequirementAnchors)
  const file = await pipeline.use(rehypeStringify).process(source)
  return String(file)
}

/**
 * The h2 and h3 headings of a markdown file, with the ids rehype-slug will
 * give them, for a contents list.
 */
export function extractHeadings(source: string): { depth: number; text: string; id: string }[] {
  const headings: { depth: number; text: string; id: string }[] = []
  let fenced = false
  for (const line of source.split('\n')) {
    // A `## ` inside a fenced block is a shell comment or a transcript, not a
    // heading, and listing it would add a contents entry that goes nowhere.
    if (line.startsWith('```')) fenced = !fenced
    if (fenced) continue
    const match = /^(#{2,3})\s+(.+)$/.exec(line)
    if (!match) continue
    const [, hashes, rawText] = match
    if (hashes === undefined || rawText === undefined) continue
    const text = rawText
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*`_]/g, '')
      .trim()
    const id = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
    headings.push({ depth: hashes.length, text, id })
  }
  return headings
}
