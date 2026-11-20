/**
 * Grant documents are markdown. Rendered with the same unified pipeline the public site uses. Raw
 * HTML in a document is dropped rather than passed through (remark-rehype's default), so a pasted
 * page cannot put markup or script into the console.
 */
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'

const pipeline = unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeStringify)

export async function renderMarkdown(source: string): Promise<string> {
  return String(await pipeline.process(source))
}
