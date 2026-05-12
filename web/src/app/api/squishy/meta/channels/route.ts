/**
 * GET /api/squishy/meta/channels — proxy to the bot's `meta.list_channels` RPC.
 *
 * Powers the `<ChannelPicker>` client component. Result is cached server-side
 * for 60 seconds in a module-scoped Map keyed on the comma-joined `types`
 * query — different consumers (e.g. text-only vs voice-only) get distinct
 * cache buckets without poisoning each other.
 *
 * Query: `?types=text,voice,category,forum,announcement` (any subset). Empty
 * or missing = every channel.
 *
 * Auth + resilience match `/api/squishy/meta/roles` — `require: 'any'`,
 * every error path returns 200 with an `error` token and an empty list so
 * the client picker falls back to a snowflake input.
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
      .map(s => s.trim().toLowerCase())
      .filter(t => VALID_TYPES.has(t))
    // Canonical cache key — order doesn't matter, sort so `text,voice` and
    // `voice,text` hit the same bucket.
    const key = types.slice().sort().join(',') || '*'

    const hit = cache.get(key)
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
      return NextResponse.json({ channels: hit.payload.channels, cached: true })
    }

    const params = types.length > 0 ? { types } : {}
    const reply = await callBot<{ channels: ChannelRow[] }>('squishy', 'meta.list_channels', params)
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
