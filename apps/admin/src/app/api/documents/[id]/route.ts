import { apiViewer } from '@/server/auth/viewer'
import { getDocument } from '@/server/grants'

/** A grant document as its markdown source, for keeping a copy outside the console. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await apiViewer(req)
  if (viewer instanceof Response) return viewer
  const doc = await getDocument((await params).id)
  if (!doc) return new Response('Not found', { status: 404 })
  const name = `${
    doc.title
      .replace(/[^A-Za-z0-9 ._-]/g, '')
      .trim()
      .replaceAll(' ', '-') || 'document'
  }.md`
  return new Response(doc.body, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}
