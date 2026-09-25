import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeSlug from 'rehype-slug'
import rehypeStringify from 'rehype-stringify'
import { visit } from 'unist-util-visit'
import type { Root, Element } from 'hast'
import { repoBlobUrl } from './site'

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

/**
 * Rewrite in-repo links so docs cross-references resolve on the site.
 *
 * ONLY DOCUMENTS THE SITE ACTUALLY PUBLISHES BECOME ROUTES. This used to map
 * every `[A-Z]*.md` to `/docs/<lowercase>` on the strength of the filename, and
 * two of the files docs/ links to are not in the published set: README.md and
 * SECURITY.md. The install page shipped with two links to `/docs/readme` and
 * the verification page one to `/docs/security`, all three 404.
 *
 * `make links` passed the whole time and was right to: it checks the links in
 * the repository, where `../README.md#what-you-need` is a real file with a real
 * heading. The repository link was valid, the site rewrote it into an invalid
 * one, and each check was correct about its own half. See check-site-links,
 * which reads the built HTML and is the half that was missing.
 *
 * Anything outside the published set goes to the file on GitHub, which is where
 * it genuinely is.
 */
function rehypeRepoLinks(publishedSlugs: ReadonlySet<string>) {
  return (tree: Root): void => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return
      const href = node.properties.href
      if (typeof href !== 'string') return

      // docs/<name>.md and ../SECURITY.md style links.
      const docMatch = /^(?:\.\.\/)?(docs\/)?([A-Z][A-Z0-9-]*)\.md(#.*)?$/.exec(href)
      if (docMatch) {
        const [, inDocs, name, fragment] = docMatch
        const slug = (name ?? '').toLowerCase()
        if (publishedSlugs.has(slug)) {
          node.properties.href = `/docs/${slug}${fragment ?? ''}`
          return
        }
        // Not published here. The anchor is dropped on purpose: it addresses a
        // heading in the markdown, and GitHub's own slugs are its business.
        node.properties.href = repoBlobUrl(`${inDocs ?? ''}${name ?? ''}.md`)
        node.properties.target = '_blank'
        node.properties.rel = ['noopener', 'noreferrer']
        return
      }
      // Any other file above docs/, such as ../research/pi-boards.md. The site
      // publishes none of these, so a relative link would resolve against the
      // page URL and 404. The file is on GitHub; the anchor goes the same way
      // as above.
      const repoMatch = /^\.\.\/([\w./-]+?)(#.*)?$/.exec(href)
      if (repoMatch) {
        node.properties.href = repoBlobUrl(repoMatch[1] ?? '')
        node.properties.target = '_blank'
        node.properties.rel = ['noopener', 'noreferrer']
        return
      }
      if (href.startsWith('http')) {
        node.properties.target = '_blank'
        node.properties.rel = ['noopener', 'noreferrer']
      }
    })
  }
}

/**
 * `publishedSlugs` is passed in rather than imported from the document
 * registry, so this module stays a pure transform: the registry reads files off
 * disk, and a link rewriter that cannot run without a repository on disk is one
 * nothing can test.
 */
export async function renderMarkdown(
  source: string,
  publishedSlugs: Iterable<string>
): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeScrollableTables)
    .use(rehypeRepoLinks, new Set(publishedSlugs))
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
