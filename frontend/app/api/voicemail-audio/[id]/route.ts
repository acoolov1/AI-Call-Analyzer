import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(
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
    const audioUrl = `${apiUrl}/api/v1/integrations/freepbx/voicemail/audio/${params.id}${search}`

    const range = request.headers.get('range')
    const response = await fetch(audioUrl, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        ...(range ? { Range: range } : {}),
      },
    })

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch audio' }, { status: response.status })
    }

    const headers = new Headers()
    const passthrough = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'content-disposition',
    ]
    passthrough.forEach((key) => {
      const value = response.headers.get(key)
      if (value) headers.set(key, value)
    })

    return new NextResponse(response.body, {
      status: response.status,
      headers,
    })
  } catch (error) {
    console.error('Error proxying voicemail audio:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

