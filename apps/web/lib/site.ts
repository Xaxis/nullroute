/**
 * Where this repository lives, in one place.
 *
 * The URL was written out in four files. That is survivable for a link in a
 * footer and not survivable for the one in `rehypeRepoLinks`, which has to
 * build a blob URL for any document the site does not publish: a fifth copy
 * inside a link rewriter is a copy that goes stale silently, on a link a reader
 * follows to check something.
 */
export const REPO_URL = 'https://github.com/Xaxis/nullroute'

/** A repo-relative path, as a link to the file on the default branch. */
export function repoBlobUrl(path: string): string {
  return `${REPO_URL}/blob/main/${path}`
}

/**
 * The social card, shared by every page. Rendered by `make brand` from the same
 * mark as the favicon. Declared once because a page that sets its own
 * `openGraph` replaces the layout's object whole rather than merging into it,
 * and a document page that forgot the image would share as a bare link.
 */
export const OG_IMAGE = {
  url: '/brand/og.png',
  width: 1200,
  height: 630,
  alt: 'nullroute. Built to be checked, not to be trusted. Air-gapped Bitcoin signer for the Raspberry Pi.',
  type: 'image/png',
} as const
