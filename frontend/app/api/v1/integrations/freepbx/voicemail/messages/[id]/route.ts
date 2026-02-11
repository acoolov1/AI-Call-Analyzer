import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

/**
 * Proxy PATCH to backend so "mark as listened" works when the app is accessed
 * from a different machine (browser sends to same-origin, we forward to backend).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'
    const search = request.nextUrl.search || ''
    const backendUrl = `${apiUrl}/api/v1/integrations/freepbx/voicemail/messages/${params.id}${search}`

    const body = await request.text()
    const contentType = request.headers.get('content-type') || 'application/json'

    const response = await fetch(backendUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': contentType,
      },
      body: body || undefined,
    })

    const data = await response.text().catch(() => '')
    try {
      const json = data ? JSON.parse(data) : {}
      return NextResponse.json(json, { status: response.status })
    } catch {
      return new NextResponse(data, { status: response.status })
    }
  } catch (error) {
    console.error('[voicemail] PATCH proxy error:', error)
    return NextResponse.json(
      { error: 'Failed to mark voicemail as listened' },
      { status: 500 }
    )
  }
}
