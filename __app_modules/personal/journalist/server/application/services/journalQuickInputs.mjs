/**
 * Journal quick inputs, assembled
 * @module journalist/application/services/journalQuickInputs
 *
 * The Journalist's quick-input intakes built over one ledger: the voice
 * intake (which the `/memo` alias also reaches, as SubmitVoiceMemo) and the
 * typed-note intake, and the endpoint each route talks to. One ledger, so a
 * recording and a note count against the same day.
 */

import {
  QuickInputIntake, QuickInputLedger, QuickInputEndpoint, boundUsers,
} from '../../../../../../__capabilities/quick-input/server/public.mjs';
import { MemoLedger } from './MemoLedger.mjs';
import { journalTextHandler } from './journalInputs.mjs';
import { SubmitVoiceMemo } from '../usecases/SubmitVoiceMemo.mjs';

const BOT = 'journalist';

/**
 * @param {Object} deps
 * @param {boolean} [deps.available] - Whether the Journalist's AI gateway is there to answer an entry
 * @param {Object} deps.processVoiceEntry
 * @param {Object} deps.processTextEntry
 * @param {Object|null} deps.journalEntryRepository
 * @param {Object|null} deps.ledgerStore - Where the ledger is kept
 * @param {{inputs?: number, bytes?: number}} [deps.limits] - Daily allowance
 * @param {(username: string) => string} [deps.timezone]
 * @param {(deviceKey: string) => Object|null|undefined} deps.deviceConfig - A device's entry in the devices file
 * @param {(username: string) => string} deps.resolveConversationId
 * @param {() => number} [deps.clock]
 * @param {Object} [deps.logger]
 * @returns {{submitVoiceMemo: SubmitVoiceMemo|null, memoDeviceUsers: Function, endpoints: {voice: QuickInputEndpoint, text: QuickInputEndpoint}}}
 */
export function createJournalQuickInputs({
  available = true, processVoiceEntry, processTextEntry, journalEntryRepository, ledgerStore,
  limits = {}, timezone, deviceConfig, resolveConversationId, clock = Date.now, logger = {},
} = {}) {
  // An input needs the Journalist's AI gateway, a journal and a ledger. Without them the routes answer 503.
  const ready = Boolean(available && journalEntryRepository?.findById && ledgerStore);
  const ledger = ready ? new QuickInputLedger({ store: ledgerStore, limits, timezone, clock }) : null;

  const submitVoiceMemo = ready
    ? new SubmitVoiceMemo({
        processVoiceEntry, processTextEntry, journalEntryRepository,
        memoLedger: new MemoLedger({ ledger }), clock, logger,
      })
    : null;
  const textIntake = ready
    ? new QuickInputIntake({
        bot: BOT, kind: 'text', ledger, clock, logger,
        handler: journalTextHandler({ processTextEntry, journalEntryRepository }),
      })
    : null;

  const usersFor = (kind) => (deviceKey) => boundUsers(deviceConfig?.(deviceKey), BOT, kind);
  const endpoint = (kind, intake) => new QuickInputEndpoint({
    intake, deviceUsers: usersFor(kind), resolveConversationId, logger,
  });

  return {
    submitVoiceMemo,
    memoDeviceUsers: usersFor('voice'),
    endpoints: {
      voice: endpoint('voice', submitVoiceMemo?.intake ?? null),
      text: endpoint('text', textIntake),
    },
  };
}

export default createJournalQuickInputs;
