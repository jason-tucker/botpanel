/**
 * View-As capability capping. Kept free of runtime imports so it stays a
 * pure function (and can be exercised outside Next.js).
 *
 * View-As shows the target's view but must never grant more than the real
 * actor has. The global gates (`botOwner`, `squishy.sudo`) are the target's
 * value AND the actor's, so a sudo impersonating the bot owner does not pass
 * `require: 'botOwner'` in withAuth. Sudo is capped by the actor's effective
 * sudo (`sudo || botOwner`), matching withAuth's `require: 'sudo'` check.
 *
 * Otter business ranks are capped the same way: each business becomes the
 * lower of the actor's and the target's rank (owner > manager > employee),
 * and a business where the actor has no rank is dropped. `otter.roleIds`
 * (used by the OC-stock role allowlist) is the intersection of both sets.
 * A bot-owner actor already passes every Otter check, so — like sudo above —
 * it keeps the target's Otter view unchanged.
 *
 * Voice channels stay the target's (that is the point of View-As).
 */
import type { BusinessRank, ResolvedCaps } from './perms'

const RANK_ORDER: Record<BusinessRank, number> = {
  employee: 1,
  manager: 2,
  owner: 3,
}

function capOtter(
  actorCaps: ResolvedCaps,
  targetCaps: ResolvedCaps,
): ResolvedCaps['otter'] {
  if (actorCaps.botOwner) return targetCaps.otter

  const businesses: Record<string, BusinessRank> = {}
  for (const [slug, targetRank] of Object.entries(targetCaps.otter.businesses)) {
    const actorRank = Object.hasOwn(actorCaps.otter.businesses, slug)
      ? actorCaps.otter.businesses[slug]
      : undefined
    if (!actorRank) continue
    businesses[slug] =
      RANK_ORDER[actorRank] < RANK_ORDER[targetRank] ? actorRank : targetRank
  }

  const actorRoles = new Set(actorCaps.otter.roleIds)
  const roleIds = targetCaps.otter.roleIds.filter((r) => actorRoles.has(r))

  return { businesses, roleIds }
}

export function capViewAsCaps(
  actorCaps: ResolvedCaps,
  targetCaps: ResolvedCaps,
): ResolvedCaps {
  return {
    botOwner: actorCaps.botOwner && targetCaps.botOwner,
    squishy: {
      ...targetCaps.squishy,
      sudo:
        targetCaps.squishy.sudo &&
        (actorCaps.squishy.sudo || actorCaps.botOwner),
    },
    otter: capOtter(actorCaps, targetCaps),
  }
}
