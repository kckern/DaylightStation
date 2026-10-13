//
// Bridge-invoked entry point: a settled scale weight becomes (or updates) a pending
// NutriLog + a slim Telegram density prompt. Always density-first; the container picker
// is a button on the prompt, not a leading question. No responseContext (not a
// user-initiated event) — uses the raw messagingGateway.
//
// Create-or-edit: when the caller passes existingLogUuid + messageId and that log is an
// untouched pending scale log, we edit the grams in place instead of posting a new
// message. If it's already touched/gone/non-pending, we no-op (the scale path's committed
// flag owns that case) — posting a fresh prompt would duplicate.

import { resolveScaleNet } from "../../../../health/server/scale-weight.mjs";
import { ApplicationError } from '#apps/common/errors/index.mjs';
import { densityForLevel } from "../../../../health/server/scale-config.mjs";
import { buildDensityKeyboard, densityPromptText } from "../lib/scalePrompts.mjs";
import { createNutriLog, serializeFoodItem } from "../../../../health/server/nutrition-records.mjs";



/**
 * Prompt body for a live scale placement. PURE — no store access, no I/O.
 *
 * With no container, no density and no notice this is byte-identical to the
 * legacy `densityPromptText(gross)` (`⚖️ <n> g`), so an untouched prompt is
 * unchanged and the Jest suite that pins that string still passes.
 *
 * Everything else here exists because a scan that changes nothing VISIBLE is
 * indistinguishable from a scan that never arrived:
 *   • CONTAINER — a `ct:` scan names the tare on the message the user is already
 *     looking at. That ACK is the only way to tell a tare that registered from
 *     one that didn't.
 *   • DENSITY — a `dl:` scan used to render nothing at all, so the edit produced
 *     byte-identical text, Telegram answered 400 "message is not modified", and
 *     the caller logged that as a successful edit. Density gates auto-accept; it
 *     is the last thing that should be invisible.
 *   • NOTICE — a transient, caller-supplied warning for a scan that was REFUSED
 *     and therefore never reached the buffer (`ct:teapot`). There is nothing in
 *     the composition to render from, so the reason is passed in instead. It is
 *     an argument and never stored, which is what makes it one-shot: the next
 *     render — a weight change, say — is clean again.
 *
 * A container id that IS in the buffer but has since been dropped from config
 * renders through that same notice line, so there is one `⚠️` mechanism rather
 * than two ways to say the same thing.
 *
 * `resolution` is the caller's ALREADY-COMPUTED `resolveScaleNet` result. The
 * caller passes the very object it persisted from, so the rendered net and the
 * stored net are the same number by construction. Recomputing here (it defaults
 * to the same call for pure-render callers) is the bug this fix removed.
 *
 * @param {{ gross: number, composition?: object, notice?: string|null }} args
 * @param {{ containers?: {items?: Array}, densityLevels?: Array }} [config] normalized scan config
 * @param {ReturnType<typeof resolveScaleNet>} [resolution]
 * @returns {string}
 */
export function buildScalePromptText({ gross, composition = {}, notice = null }, config = {}, resolution = null) {
  const containers = config?.containers || { items: [] };
  const r = resolution || resolveScaleNet({ gross, composition }, containers);
  const lines = [densityPromptText(gross)];

  // One transient warning line, whatever its source.
  let warning = notice || null;

  if (r.error) {
    warning = warning || `container "${r.container?.id}" has no usable weight — not tared`;
  } else if (r.refused) {
    const name = r.container.label || r.container.id;
    warning = warning || `${name} (${r.container.grams} g) is not lighter than the reading — not tared`;
  } else if (r.unknownId) {
    // Stored, then removed from config between the scan and this render.
    warning = warning || `unknown container "${r.unknownId}" — not tared`;
  } else if (r.container) {
    lines[0] = `⚖️ ${gross} g gross`;
    lines.push(`➖ ${r.container.emoji || ''} ${r.container.label || r.container.id} (${r.container.grams} g)`.trim());
    lines.push(`= ${r.net} g net`);
  }

  // A level absent from the table renders nothing rather than a half-line —
  // ApplyScanToComposition refuses those at scan time, so reaching here means
  // the table changed under a buffered selection.
  const level = densityForLevel(config, composition?.density);
  if (level) lines.push(`${level.emoji} ${level.label} (${level.kcal_per_g} kcal/g)`);

  if (warning) lines.push(`⚠️ ${warning}`);

  return lines.join('\n');
}

export class LogFoodFromScale {
  #messagingGateway; #foodLogStore; #conversationStateStore; #scaleConfig; #config; #logger; #encodeCallback;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    this.#messagingGateway = deps.messagingGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#scaleConfig = deps.scaleConfig;
    this.#config = deps.config;
    this.#logger = deps.logger || console;
    this.#encodeCallback = deps.encodeCallback || ((cmd, data) => JSON.stringify({ cmd, ...data }));
  }

  #isUntouched(log) {
    return !!log
      && log.status === 'pending'
      && log.metadata?.source === 'scale'
      && log.metadata?.containerId == null
      && log.metadata?.densityLevel == null;
  }

  async execute(input) {
    const { userId, conversationId, grams, unit, scaleId, existingLogUuid, messageId, composition, notice = null } = input;
    const gross = Math.round(Number(grams));
    if (!Number.isFinite(gross) || gross <= 0) {
      this.#logger.warn?.('logScale.badGrams', { scaleId, grams });
      throw new ApplicationError('bad grams', {
        code: 'NUTRIBOT_SCALE_BAD_GRAMS', grams,
      });
    }

    const cfg = this.#scaleConfig;

    // ONE resolution, used for BOTH the persisted grams and the prompt text below.
    // Do not recompute either of them separately.
    const resolution = resolveScaleNet({ gross, composition }, cfg?.containers);
    const net = resolution.net;
    if (resolution.error) {
      this.#logger.warn?.('logScale.tareFailed', {
        scaleId, gross, containerId: resolution.container?.id, error: resolution.error.message,
      });
    }
    if (resolution.refused) {
      this.#logger.warn?.('logScale.tareExceedsGross', {
        scaleId, gross, containerId: resolution.container?.id, containerGrams: resolution.container?.grams,
      });
    }

    // Edit-in-place: an untouched pending scale prompt exists → update its grams only.
    if (existingLogUuid && messageId) {
      const existing = await this.#foodLogStore.findByUuid(existingLogUuid, userId);
      if (this.#isUntouched(existing)) {
        const item0 = serializeFoodItem(existing.items[0]);
        const updated = existing.with({
          items: [{ ...item0, grams: net }],
          metadata: { ...existing.metadata, grossGrams: gross },
        }, new Date());
        await this.#foodLogStore.save(updated);
        const choices = buildDensityKeyboard(cfg, this.#encodeCallback, existingLogUuid);
        try {
          const editText = buildScalePromptText({ gross, composition, notice }, cfg, resolution);
          await this.#messagingGateway.updateMessage(conversationId, messageId, { text: editText, choices, inline: true });
        } catch (e) {
          this.#logger.warn?.('logScale.editFailed', { error: e.message });
        }
        this.#logger.info?.('logScale.edited', { conversationId, logUuid: existingLogUuid, gross, net });
        return { success: true, logUuid: existingLogUuid, messageId: String(messageId), stage: 'density', edited: true };
      }
      // Touched / missing / non-pending: the user owns it now. The scale path's committed
      // flag handles the still-loaded food; posting a fresh prompt would duplicate. No-op.
      return { success: true, logUuid: existingLogUuid, edited: false, touched: true };
    }

    const timezone = this.#config?.getUserTimezone?.(userId) || 'America/Los_Angeles';
    const nutriLog = createNutriLog({
      userId,
      conversationId,
      // NET, not gross: SelectScaleDensity multiplies this by kcal_per_g.
      items: [{ label: 'Unknown', grams: net, calories: 0, unit: unit || 'g', amount: 1, color: 'yellow' }],
      metadata: { source: 'scale', scaleId: scaleId || null, grossGrams: gross },
      timezone,
      timestamp: new Date(),
    });
    await this.#foodLogStore.save(nutriLog);

    const text = buildScalePromptText({ gross, composition, notice }, cfg, resolution);
    const choices = buildDensityKeyboard(cfg, this.#encodeCallback, nutriLog.id);
    if (this.#conversationStateStore) {
      await this.#conversationStateStore.set(conversationId, {
        conversationId,
        activeFlow: 'scale_describe',
        flowState: { pendingLogUuid: nutriLog.id, openedAt: new Date().toISOString() },
      });
    }

    const sent = await this.#messagingGateway.sendMessage(conversationId, text, { choices, inline: true });
    const newMessageId = sent?.messageId;
    if (newMessageId) {
      await this.#foodLogStore.save(nutriLog.with({ metadata: { ...nutriLog.metadata, messageId: String(newMessageId) } }, new Date()));
    }

    this.#logger.info?.('logScale.posted', { conversationId, logUuid: nutriLog.id, gross, net, stage: 'density' });
    return { success: true, logUuid: nutriLog.id, messageId: newMessageId ? String(newMessageId) : null, stage: 'density', edited: undefined };
  }
}

export default LogFoodFromScale;
