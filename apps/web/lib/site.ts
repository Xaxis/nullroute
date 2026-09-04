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
