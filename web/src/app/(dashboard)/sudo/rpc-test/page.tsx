/**
 * /sudo/rpc-test — bot-owner-only smoke test for the panel→bot command bus.
 *
 * Two small forms, one per bot, that POST to `/api/admin/rpc-test` with
 * `{ bot, message }` and render the reply. Lets an operator verify the
 * Wave-7a client (this PR) is correctly publishing on `cmd.<bot>.echo`
 * and reading back from `res.<requestId>` once the bot-side subscribers
 * land alongside.
 *
 * Gating: bot-owner only. Mirrors the `/sudo/debug` 403 card pattern for
 * squishy-sudo-without-owner — RPC test is owner-only in MVP because the
 * surface is a write-side diagnostic.
 *
 * Read-only from a DB standpoint — no Drizzle reads. Server component
 * just renders the chrome; the actual roundtrip lives in the client
 * `<RpcTestCard>` component which calls `<ServerForm>` to inject CSRF.
 */
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { resolveAccess } from '@/lib/auth/perms'
import { env } from '@/lib/env'
import { RpcTestCard } from './RpcTestCard'

export const dynamic = 'force-dynamic'

function NotAuthorizedCard({ isSudo }: { isSudo: boolean }) {
  return (
    <div className="p-6 sm:p-10 pt-16 md:pt-10">
      <div className="max-w-md mx-auto rounded-2xl border border-line bg-bg-card p-6 flex flex-col gap-3">
        <h1 className="text-xl font-semibold">403 — Not allowed</h1>
        <p className="text-ink-dim text-sm">
          {isSudo ? (
            <>
              RPC test is bot-owner-only in MVP. It&apos;s a write-side
              diagnostic that exercises the command bus end-to-end; the
              same gate as <code className="font-mono">/sudo/debug</code>{' '}
              applies.
            </>
          ) : (
            <>
              RPC test is bot-owner-only. If you think you should have
              access, ask the bot owner.
            </>
          )}
        </p>
      </div>
    </div>
  )
}

export default async function RpcTestPage() {
  const session = await getSession()
  if (!session) redirect('/api/auth/login')

  const access = await resolveAccess(session)
  if (!access.botOwner) {
    return <NotAuthorizedCard isSudo={access.squishy.sudo} />
  }

  const rpcConfigured = Boolean(env.BOTPANEL_RPC_SECRET)

  return (
    <div className="p-6 sm:p-10 pt-16 md:pt-10">
      <div className="max-w-4xl mx-auto flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">RPC test</h1>
          <p className="text-sm text-ink-dim">
            Panel → bot command bus smoke test. Sends{' '}
            <code className="font-mono">cmd.&lt;bot&gt;.echo</code> with the
            HMAC envelope and renders the reply from{' '}
            <code className="font-mono">res.&lt;requestId&gt;</code>.
          </p>
          {!rpcConfigured && (
            <div className="mt-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">
              <code className="font-mono">BOTPANEL_RPC_SECRET</code> is not
              set in the panel env — every call will return{' '}
              <code className="font-mono">rpc-not-configured</code>. Set it
              in <code className="font-mono">.env</code> (and the matching
              value on the bot side) before testing.
            </div>
          )}
          <p className="text-xs text-ink-dim/80 mt-2">
            Until the Wave 7b bot subscribers land you should expect{' '}
            <code className="font-mono">timeout</code> — that means the
            panel side is doing its half; nobody&apos;s replying yet.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <RpcTestCard bot="squishy" />
          <RpcTestCard bot="otter" />
        </div>
      </div>
    </div>
  )
}
