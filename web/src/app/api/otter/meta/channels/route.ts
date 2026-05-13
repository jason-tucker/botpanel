/**
 * GET /api/otter/meta/channels — proxy to otterbot's `meta.list_channels` RPC.
 *
 * Mirror of the squishy variant. Powers `<ChannelPicker bot="otter">` for
 * surfaces under /otter (currently the OC Post-to-channel form; future
 * Caked / business-message surfaces). Same 60s server-side cache,
 * same fall-back-to-snowflake-on-error posture.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { callBot } from '@/lib/botrpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ChannelRow = {
  id: string
  name: string
  type: 'text' | 'voice' | 'category' | 'forum' | 'announcement' | 'other'
  parentId: string | null
  position: number
}

type Cached = { ts: number; payload: { channels: ChannelRow[] } }
const CACHE_TTL_MS = 60_000
const cache = new Map<string, Cached>()

const VALID_TYPES = new Set(['text', 'voice', 'category', 'forum', 'announcement'])

export const GET = withAuth(
  async (req: NextRequest) => {
    const raw = req.nextUrl.searchParams.get('types') ?? ''
    const types = raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((t) => VALID_TYPES.has(t))
    const key = types.slice().sort().join(',') || '*'

    const hit = cache.get(key)
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
      return NextResponse.json({ channels: hit.payload.channels, cached: true })
    }

    const params = types.length > 0 ? { types } : {}
    const reply = await callBot<{ channels: ChannelRow[] }>('otter', 'meta.list_channels', params)
    if (!reply.ok) {
      return NextResponse.json({ channels: [], error: reply.error })
    }

    const payload = {
      channels: Array.isArray(reply.data?.channels) ? reply.data.channels : [],
    }
    cache.set(key, { ts: Date.now(), payload })
    return NextResponse.json({ channels: payload.channels, cached: false })
  },
  { require: 'any' },
)
