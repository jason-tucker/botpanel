/**
 * Plain-language messages for bot RPC / API error codes.
 *
 * Pure (no imports, no I/O) so it works in server and client components and
 * in `node --experimental-strip-types` scratch tests.
 *
 * `describeError('channel-not-allowed')` returns "That channel is not allowed
 * for this business (channel-not-allowed)". The code stays visible so support
 * can still search for it. Anything that is not a bare code (a sentence from a
 * validator, zod text, etc.) passes through unchanged. Unknown codes are
 * humanized ("some-new-code" -> "Some new code (some-new-code)").
 *
 * Diagnostics pages (sudo/debug, sudo/rpc-test) deliberately keep raw codes.
 */

const CODE_RE = /^[a-z0-9_-]+$/

const MAP: Record<string, string> = {
  // transport / panel
  'rpc-not-configured': 'The panel is not configured to talk to the bot',
  timeout: 'The bot did not answer in time. Try again in a moment',
  'redis-down': 'The panel cannot reach the message bus right now',
  'bad-reply': 'The bot sent a reply the panel could not understand',
  'reply-rejected': 'The bot reply failed its integrity check',
  'unknown-verb': 'The bot does not support this action yet (it may need an update)',
  'handler-threw': 'The bot hit an internal error handling this request',
  csrf: 'Your session token expired. Reload the page and try again',
  unauthorized: 'You need to sign in again',
  forbidden: 'You do not have permission to do that',
  invalid: 'Some of the submitted values are not valid',
  'invalid-json': 'The request could not be read',
  'not-found': 'That item was not found',
  rate_limited: 'Too many requests. Wait a moment and try again',
  'rate-limited': 'Too many requests. Wait a moment and try again',
  'db-error': 'A database error occurred',
  'db-unavailable': 'The database is unavailable right now',
  'db-write-failed': 'The change could not be saved to the database',
  'feature-disabled': 'This feature is turned off',

  // otter
  'invalid-params': 'The request was missing or had invalid values',
  'bad-params': 'The request was missing or had invalid values',
  'invalid-body': 'The request body is not valid',
  'business-not-found': 'That business was not found',
  'business-inactive': 'That business is not active',
  'business-not-configured': 'That business has not been fully set up yet',
  'mke-not-supported': 'This action is not supported for MKE',
  'invalid-business-slug': 'That business name is not valid',
  'bad-slug': 'That business name is not valid',
  'guild-not-found': 'The Discord server was not found',
  'guild-not-cached': 'The bot has not loaded the Discord server yet. Try again shortly',
  'unknown-key': 'That message key is not recognized',
  'send-failed': 'The bot could not send the message to Discord',
  'not-text-based': 'That channel cannot hold text messages',
  'invalid-url': 'That link is not a valid URL',
  'invalid-style': 'That button style is not valid',
  'invalid-message-key': 'That message key is not valid',
  'invalid-label': 'That button label is not valid',
  'invalid-id': 'That ID is not valid',
  'invalid-emoji': 'That emoji is not valid',
  'invalid-actor-user-id': 'Your user ID was rejected by the bot',
  'channel-not-found': 'Channel not found',
  'channel-not-allowed': 'That channel is not allowed for this business',
  'write-failed': 'The bot could not save the change',
  'too-many-ids': 'Too many items were submitted at once',
  'role-missing': 'A required Discord role is missing',
  'role-hierarchy': 'The bot role is below the role being changed, so Discord refused',
  'protected-target': 'That member is protected and cannot be changed this way',
  'member-not-found': 'Member not found in the Discord server',
  'invalid-user-id': 'That user ID is not valid',
  'invalid-type': 'That type is not valid',
  'invalid-reason': 'That reason is not valid',
  'invalid-rank': 'That rank is not valid',
  'invalid-ordered-ids': 'The new order is not valid',
  'invalid-kind': 'That kind is not valid',
  'invalid-enabled': 'The enabled setting is not valid',
  'invalid-channel-id': 'That channel ID is not valid',
  'discord-error': 'Discord returned an error',
  'delete-failed': 'The bot could not delete that item',
  'body-too-long': 'The text is too long',
  'body-required': 'Text is required',
  'bad-user-id': 'That user ID is not valid',
  'already-at-top-rank': 'That person is already at the top rank',
  'already-at-bottom-rank': 'That person is already at the lowest rank',

  // squishy
  'already-added': 'That is already added',
  'already-expired': 'That has already expired',
  'already-owner': 'That person is already the owner',
  'bad-channel': 'That channel is not valid',
  'bad-channel-type': 'That kind of channel cannot be used here',
  'bad-department-slug': 'That department is not valid',
  'bad-expires': 'That expiry time is not valid',
  'bad-mappings': 'The role mappings are not valid',
  'bad-op': 'That operation is not valid',
  'bad-role': 'That role is not valid',
  'bad-tier-slug': 'That tier is not valid',
  'bad-voice-channel-id': 'That voice channel is not valid',
  'game-exists': 'That game already exists',
  'game-not-found': 'That game was not found',
  'guild-not-available': 'The Discord server is not available right now',
  'guild-unavailable': 'The Discord server is not available right now',
  'invalid-locked': 'The locked setting is not valid',
  'invalid-name': 'That name is not valid',
  'member-not-in-channel': 'That member is not in the channel',
  'message-too-long': 'The message is too long',
  'missing-permissions': 'The bot is missing a Discord permission needed for this',
  'name-too-long': 'That name is too long',
  'not-temporary': 'That channel is not temporary',
  'real-name-too-long': 'That real name is too long',
  'role-key-unknown': 'That role key is not recognized',
  'role-missing-in-guild': 'That role no longer exists in the Discord server',
  'role-not-curated': 'That role is not on the allowed list',
  'role-not-linked': 'That role is not linked',
  'static-channel': 'That channel is permanent and cannot be changed this way',
  'user-not-found': 'User not found',
  'already-posted': 'That was already posted',
  canceled: 'The action was canceled',
  'channel-unreachable': 'The bot cannot reach that channel',
  'empty-spec': 'Nothing was specified to change',
  'in-progress': 'That is already in progress',
  'is-owner': 'That person is the owner and cannot be changed this way',
  'missing-fields': 'Some required fields are missing',
  'no-selection': 'Nothing was selected',
  'not-configured': 'This has not been configured yet',
  'owner-dm-failed': 'The bot could not send the owner a direct message',
  'owner-unset': 'No owner is set',
  'thread-not-thread': 'The configured thread is not a thread',
  'thread-unset': 'No thread is configured',
  'unknown-department': 'That department is not recognized',
  'unknown-tier': 'That tier is not recognized',
  'view-required-for-ping': 'A role needs View access before it can be pinged',
  'voice-channel-fetch-failed': 'The bot could not load that voice channel',
}

function humanize(code: string): string {
  const s = code.replace(/[-_]+/g, ' ').trim()
  return s.length === 0 ? code : s.charAt(0).toUpperCase() + s.slice(1)
}

/** Message for a bare error code, or the input unchanged if it is a sentence. */
export function describeError(code: string): string {
  if (typeof code !== 'string' || !CODE_RE.test(code)) return code
  const msg = Object.hasOwn(MAP, code) ? MAP[code] : humanize(code)
  return `${msg} (${code})`
}
