import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeSlug from 'rehype-slug'
import rehypeStringify from 'rehype-stringify'
import { visit } from 'unist-util-visit'
import type { Element, ElementContent, Root, RootContent } from 'hast'
import { DOCS, GROUPS, type DocGroup, type DocMeta } from './docs'
import { rehypeRequirementAnchors, rehypeScrollableTables } from './markdown'
import { readRepoFile } from './repo'
import { repoBlobUrl } from './site'

/**
 * The documentation as a book: every registered file a chapter, every
 * second-level heading in it a page.
 *
 * SPLIT AFTER RENDERING, NOT BEFORE. Each file goes through the Markdown
 * pipeline whole, so every heading gets the id GitHub gives it in the whole
 * file, duplicates numbered in file order, and only then is the tree cut at
 * its h2 elements. Splitting the Markdown first would restart the numbering in
 * every section, and a link written in the repository as #known-gaps-1 would
 * land nowhere.
 *
 * LINKS ARE RESOLVED ACROSS THE WHOLE BOOK. A fragment names an element in a
 * file, and after the split that element lives on one particular page, so
 * every link is rewritten to the page that holds its target. A target that
 * cannot be found stops the build: check-links proves every anchor exists in
 * the repository, so a miss here is a defect in this file, and a site that
 * quietly links to the top of the wrong page is worse than one that does not
 * build.
 */

export interface Heading {
  readonly depth: number
  readonly text: string
  readonly id: string
}

export interface Section {
  /** The page's path segment: the heading's id without a leading number. */
  readonly slug: string
  /** The id GitHub gives this heading, kept so old links still resolve. */
  readonly id: string
  readonly title: string
  readonly href: string
  readonly html: string
  readonly headings: readonly Heading[]
  /** The section's opening sentence or two, for cards and descriptions. */
  readonly summary: string
}

export interface Chapter {
  readonly meta: DocMeta
  readonly href: string
  /** What comes before the first h2, rendered. Empty when there is none. */
  readonly introHtml: string
  readonly sections: readonly Section[]
  /** SHA-256 of the file, shown under every page cut from it. */
  readonly digest: string
}

export interface Book {
  readonly chapters: readonly Chapter[]
  readonly groups: readonly { readonly name: DocGroup; readonly chapters: readonly Chapter[] }[]
  /** Every page in reading order: each chapter's overview, then its sections. */
  readonly pages: readonly {
    readonly href: string
    readonly title: string
    readonly chapter: Chapter
  }[]
}

function textOf(node: ElementContent | RootContent): string {
  if (node.type === 'text') return node.value
  if (node.type === 'element') return node.children.map(textOf).join('')
  return ''
}

function isElement(node: RootContent, tag?: string): node is Element {
  return node.type === 'element' && (tag === undefined || node.tagName === tag)
}

/** "1-the-manifest-and-the-root-hash" reads better as a path without the 1. */
function sectionSlug(id: string): string {
  return id.replace(/^\d+-/, '')
}

function summarise(nodes: readonly RootContent[]): string {
  const first = nodes.find((node) => isElement(node, 'p'))
  // A lead-in that ends in a colon introduces a table or list the card cannot
  // show, so it ends at the clause instead.
  const text =
    first === undefined ? '' : textOf(first).replace(/\s+/g, ' ').trim().replace(/:$/, '.')
  if (text.length <= 180) return text
  const cut = text.slice(0, 180)
  return `${cut.slice(0, cut.lastIndexOf(' '))}...`
}

function stringify(nodes: readonly RootContent[]): string {
  const root: Root = { type: 'root', children: [...nodes] }
  return unified().use(rehypeStringify).stringify(root)
}

function headingsOf(nodes: readonly RootContent[]): Heading[] {
  const found: Heading[] = []
  for (const node of nodes) {
    if (!isElement(node)) continue
    const depth = node.tagName === 'h3' ? 3 : node.tagName === 'h4' ? 4 : 0
    const id = node.properties.id
    if (depth === 0 || typeof id !== 'string') continue
    found.push({ depth, text: textOf(node).trim(), id })
  }
  return found
}

interface Parsed {
  readonly meta: DocMeta
  readonly tree: Root
  readonly digest: string
}

async function parse(meta: DocMeta): Promise<Parsed> {
  const source = readRepoFile(meta.file)
  const pipeline = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeScrollableTables)
  if (meta.requirements === true) pipeline.use(rehypeRequirementAnchors)
  const tree = await pipeline.run(pipeline.parse(source))
  return {
    meta,
    tree,
    digest: createHash('sha256').update(source, 'utf8').digest('hex'),
  }
}

/** The top-level nodes of a parsed file, cut into the intro and its sections. */
function cut(tree: Root): { intro: RootContent[]; parts: { h2: Element; nodes: RootContent[] }[] } {
  const intro: RootContent[] = []
  const parts: { h2: Element; nodes: RootContent[] }[] = []
  for (const node of tree.children) {
    // The h1 is the chapter's title, which the page draws itself.
    if (isElement(node, 'h1')) continue
    if (isElement(node, 'h2')) {
      parts.push({ h2: node, nodes: [] })
      continue
    }
    const current = parts.at(-1)
    if (current === undefined) intro.push(node)
    else current.nodes.push(node)
  }
  return { intro, parts }
}

/** Where every id in every file ended up: file, then id, then page. */
function locate(parsed: readonly Parsed[]): Map<string, Map<string, string>> {
  const where = new Map<string, Map<string, string>>()
  for (const { meta, tree } of parsed) {
    const ids = new Map<string, string>()
    const chapterHref = `/docs/${meta.slug}`
    const { intro, parts } = cut(tree)
    const record = (nodes: readonly RootContent[], href: string): void => {
      for (const node of nodes) {
        if (!isElement(node)) continue
        visit(node, 'element', (el: Element) => {
          if (typeof el.properties.id === 'string') ids.set(el.properties.id, href)
        })
      }
    }
    record(intro, chapterHref)
    for (const part of parts) {
      const id = part.h2.properties.id
      if (typeof id !== 'string') throw new Error(`${meta.file}: a section heading has no id`)
      const href = `${chapterHref}/${sectionSlug(id)}`
      ids.set(id, href)
      record(part.nodes, href)
    }
    where.set(meta.file, ids)
  }
  return where
}

function rewriteLinks(
  nodes: readonly RootContent[],
  file: string,
  pageHref: string,
  where: Map<string, Map<string, string>>
): void {
  const dir = posix.dirname(file)
  for (const node of nodes) {
    if (!isElement(node)) continue
    visit(node, 'element', (el: Element) => {
      if (el.tagName !== 'a') return
      const href = el.properties.href
      if (typeof href !== 'string') return
      if (/^https?:/.test(href)) {
        el.properties.target = '_blank'
        el.properties.rel = ['noopener', 'noreferrer']
        return
      }
      if (href.startsWith('mailto:')) return

      const [path = '', fragment] = href.split('#', 2)
      const target = path === '' ? file : posix.normalize(posix.join(dir, path)).replace(/\/$/, '')
      const ids = where.get(target)

      if (ids === undefined) {
        // Not a chapter: the file on GitHub, which is where it is readable.
        if (target.startsWith('..')) return
        el.properties.href = `${repoBlobUrl(target)}${fragment === undefined ? '' : `#${fragment}`}`
        el.properties.target = '_blank'
        el.properties.rel = ['noopener', 'noreferrer']
        return
      }

      const chapter = DOCS.find((d) => d.file === target)
      if (fragment === undefined || fragment === '') {
        el.properties.href = `/docs/${chapter?.slug ?? ''}`
        return
      }
      const page = ids.get(fragment)
      if (page === undefined) {
        throw new Error(
          `${file}: the link ${href} names #${fragment}, which no heading or anchor in ${target} has`
        )
      }
      // A section's own heading is the page itself, so it needs no fragment.
      const isPageHeading = page === `/docs/${chapter?.slug ?? ''}/${sectionSlug(fragment)}`
      if (isPageHeading) el.properties.href = page
      else if (page === pageHref) el.properties.href = `#${fragment}`
      else el.properties.href = `${page}#${fragment}`
    })
  }
}

let cached: Promise<Book> | undefined

async function build(): Promise<Book> {
  const parsed = await Promise.all(DOCS.map(parse))
  const where = locate(parsed)

  const chapters: Chapter[] = parsed.map(({ meta, tree, digest }) => {
    const href = `/docs/${meta.slug}`
    const { intro, parts } = cut(tree)
    rewriteLinks(intro, meta.file, href, where)
    const sections = parts.map((part): Section => {
      const id = String(part.h2.properties.id)
      const slug = sectionSlug(id)
      const sectionHref = `${href}/${slug}`
      rewriteLinks(part.nodes, meta.file, sectionHref, where)
      return {
        slug,
        id,
        title: textOf(part.h2).trim(),
        href: sectionHref,
        html: stringify(part.nodes),
        headings: headingsOf(part.nodes),
        summary: summarise(part.nodes),
      }
    })
    const slugs = new Set(sections.map((s) => s.slug))
    if (slugs.size !== sections.length) {
      throw new Error(`${meta.file}: two sections reduce to the same page name`)
    }
    return { meta, href, introHtml: stringify(intro), sections, digest }
  })

  const pages = chapters.flatMap((chapter) => [
    { href: chapter.href, title: chapter.meta.title, chapter },
    ...chapter.sections.map((s) => ({ href: s.href, title: s.title, chapter })),
  ])

  return {
    chapters,
    groups: GROUPS.map((name) => ({
      name,
      chapters: chapters.filter((c) => c.meta.group === name),
    })),
    pages,
  }
}

/** The whole book, built once per build. */
export function loadBook(): Promise<Book> {
  cached ??= build()
  return cached
}

/**
 * Where a repository file, and optionally an anchor in it, is published.
 *
 * For pages other than the docs: the home page linking to the entropy worked
 * example, the profile page to a requirement. Throws for a file that is not a
 * chapter or an anchor that is not in it, for the reason given at the top.
 */
export async function docHref(file: string, fragment?: string): Promise<string> {
  const book = await loadBook()
  const chapter = book.chapters.find((c) => c.meta.file === file)
  if (chapter === undefined) throw new Error(`docHref: ${file} is not a chapter of the docs`)
  if (fragment === undefined) return chapter.href
  const section = chapter.sections.find((s) => s.id === fragment)
  if (section !== undefined) return section.href
  const holder = chapter.sections.find((s) => s.html.includes(`id="${fragment}"`))
  if (holder !== undefined) return `${holder.href}#${fragment}`
  if (chapter.introHtml.includes(`id="${fragment}"`)) return `${chapter.href}#${fragment}`
  throw new Error(`docHref: ${file} has no #${fragment}`)
}

/**
 * Where each signer profile requirement is published, by lowercase id
 * (sp-ent-1). The requirement anchors are added by rehypeRequirementAnchors,
 * so this reads them back off the rendered sections rather than guessing.
 */
export async function requirementHrefs(): Promise<ReadonlyMap<string, string>> {
  const book = await loadBook()
  const chapter = book.chapters.find((c) => c.meta.requirements === true)
  if (chapter === undefined) throw new Error('requirementHrefs: no chapter carries requirements')
  const found = new Map<string, string>()
  for (const section of chapter.sections) {
    for (const match of section.html.matchAll(/id="(sp-[a-z]+-\d+)"/g)) {
      const id = match[1]
      if (id !== undefined) found.set(id, `${section.href}#${id}`)
    }
  }
  return found
}
