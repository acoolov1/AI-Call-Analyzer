import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

const looksLikeStaticAsset = (pathname: string) => {
  // Any path with a file extension (e.g. .png, .css, .js) should be treated as an asset.
  return /\.[a-zA-Z0-9]+$/.test(pathname)
}

export function middleware(req: NextRequest) {
  const res = NextResponse.next()

  // Prevent stale HTML/RSC responses across deployments on self-hosted setups.
  // Static assets should keep their own caching behavior.
  if (req.method === 'GET') {
    const pathname = req.nextUrl.pathname || '/'
    if (!looksLikeStaticAsset(pathname)) {
      res.headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate')
    }
  }

  return res
}

export const config = {
  // Exclude Next internals and API routes.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}

