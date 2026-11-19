/**
 * IMailbox Port Interface
 *
 * The triage module's only door to a user's mailbox. Every method takes the
 * triage `username` first; nothing is global.
 *
 * @typedef {Object} MailRef
 * @property {string} provider  Opaque provider id.
 * @property {string} accountId  The triage username.
 * @property {'message'} kind    The mailbox's own ref shape (not the work module's).
 * @property {string} id
 *
 * @typedef {Object} MailMessage
 * @property {MailRef} ref
 * @property {string} threadId
 * @property {string} version              Provider history id; changes when the message does.
 * @property {{name: string, address: string}} from
 * @property {string[]} to                 Addresses.
 * @property {string} subject
 * @property {string} snippet
 * @property {number} receivedAt           Epoch ms.
 * @property {string[]} labels
 * @property {boolean} starred
 * @property {boolean} hasAttachments
 * @property {boolean} automated           Bulk/list/noreply/auto-submitted.
 * @property {boolean} ownerRepliedInThread
 * @property {string|null} url             Link to the message in the provider's web client.
 * @property {string|null} sourceName      Display name of the mailbox source (supplied by the adapter).
 *
 * @typedef {Object} MailboxCapabilities
 * @property {boolean} read
 * @property {boolean} modify
 * @property {boolean} compose
 * @property {boolean} send
 *
 * @typedef {Object} IMailbox
 * @property {string} [displayName]  Owner-facing name of the mailbox source (supplied by the adapter).
 * @property {(username: string) => MailboxCapabilities} capabilities
 * @property {(username: string, opts: {newerThanDays?: number, max?: number}) => Promise<MailMessage[]>} listInbox
 * @property {(username: string, id: string) => Promise<MailMessage|null>} getMessage  null when gone.
 * @property {(username: string, id: string) => Promise<{version: string}>} archive    Removes INBOX.
 * @property {(username: string, id: string) => Promise<{version: string}>} unarchive  Adds INBOX.
 * @property {(username: string, id: string) => Promise<{version: string}>} star
 * @property {(username: string, id: string) => Promise<{version: string}>} unstar
 * @property {(username: string, address: string) => Promise<{sentToCount: number}>} senderHistory  Capped at 5.
 * @property {(username: string, draft: {threadId?: string, to: string, subject: string, body: string}) => Promise<{draftId: string}>} createDraft
 * @property {(username: string, draftId: string, patch: {body: string}) => Promise<{draftId: string}>} updateDraft
 * @property {(username: string, draftId: string) => Promise<{messageId: string}>} sendDraft
 *
 * Write methods throw an Error with `code: 'MAILBOX_SCOPE_MISSING'` when the
 * matching capability is false or the provider answers 403 insufficientPermissions,
 * and `code: 'MAILBOX_NOT_FOUND'` when the message or draft no longer exists.
 *
 * Implemented by a mailbox adapter.
 */
export const MAILBOX_SCOPE_MISSING = 'MAILBOX_SCOPE_MISSING';
export const MAILBOX_NOT_FOUND = 'MAILBOX_NOT_FOUND';
export default {};
