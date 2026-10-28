import { visit } from 'unist-util-visit'
import type { Root, Element, ElementContent } from 'hast'

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
export function rehypeScrollableTables() {
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
export function rehypeRequirementAnchors() {
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
