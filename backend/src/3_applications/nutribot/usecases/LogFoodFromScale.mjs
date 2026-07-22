//
// Bridge-invoked entry point: a settled scale weight becomes (or updates) a pending
// NutriLog + a slim Telegram density prompt. Always density-first; the container picker
// is a button on the prompt, not a leading question. No responseContext (not a
// user-initiated event) — uses the raw messagingGateway.
//
// Create-or-edit: when the bridge passes existingLogUuid + messageId and that log is an
// untouched pending scale log, we edit the grams in place instead of posting a new
// message. If it's already touched/gone/non-pending, we no-op (the bridge's committed
// flag owns that case) — posting a fresh prompt would duplicate.

import { NutriLog } from '#domains/nutrition/entities/NutriLog.mjs';
import { computeNet } from '#domains/nutrition/index.mjs';
import { buildDensityKeyboard, densityPromptText } from '../lib/scaleNutribotConfig.mjs';

/**
 * Resolve a scanned container id against the table and apply its tare.
 *
 * SINGLE SOURCE for the scale path's net weight: both the prompt the user reads
 * and the grams that get persisted derive from one call to this, so they cannot
 * disagree. They used to — the prompt rendered `gross - tare` while the log kept
 * the gross, so a 420 g mug of soup on a 350 g tare printed "= 70 g net" and then
 * billed 588 kcal instead of 98.
 *
 * The arithmetic itself is the domain's (`computeNet`), which clamps a negative
 * net to 0 and refuses non-finite input.
 *
 * A tare that would leave nothing behind is REFUSED, not applied: `FoodItem`
 * requires `grams > 0`, so computeNet's clamp-to-0 is unstorable, and a 0 g entry
 * would in any case be the "silent 0 kcal" the domain exists to prevent. Refusing
 * keeps the gross on the record and surfaces a warning in the prompt, which is
 * exactly what the button path (`SelectScaleContainer`) has always done for
 * `tare >= gross`. Both paths now express that rule once, here.
 *
 * `computeNet` THROWS on a malformed container row (a `grams` that is not a
 * finite number — reachable when a raw, un-normalized config is injected). It is
 * caught here rather than allowed to escape, and the failure degrades to the
 * UNTARED weight: the entry is still worth recording, and because the prompt
 * reads the same `error` flag the user sees the tare was not applied. Letting it
 * throw would take down the relay call for a config typo.
 *
 * @param {{ gross: number, composition?: object }} args
 * @param {{ items?: Array<{id:string,label?:string,emoji?:string,grams:number}> }} [containers]
 * @returns {{net:number, gross:number, container:object|null, tared:boolean,
 *            refused:boolean, unknownId:string|null, error:Error|null}}
 */
export function resolveScaleNet({ gross, composition = {} }, containers = { items: [] }) {
  const base = { net: gross, gross, container: null, tared: false, refused: false, unknownId: null, error: null };

  const containerId = composition?.container;
  if (!containerId || containerId === 'none') return base;

  const item = (containers?.items || []).find((c) => c.id === containerId);
  if (!item) return { ...base, unknownId: containerId };

  let result;
  try {
    result = computeNet(gross, item);
  } catch (error) {
    return { ...base, container: item, error };
  }

  // `clamped` is computeNet's negative-net flag; `netG <= 0` also covers a tare
  // exactly equal to the gross. Either way there is no food to log.
  if (result.clamped || result.netG <= 0) {
    return { ...base, container: item, refused: true };
  }
  return { ...base, net: result.netG, container: item, tared: result.tared };
}

/**
 * Prompt body for a live scale placement. PURE — no store access, no I/O.
 *
 * With no container in the buffer this is byte-identical to the legacy
 * `densityPromptText(gross)` (`⚖️ <n> g`), so an untared prompt is unchanged.
 * Once a `ct:` scan lands, the container is NAMED on the message the user is
 * already looking at — that ACK is the only way to tell a tare that registered
 * from one that didn't. An id no longer in config renders a visible warning
 * rather than nothing, for the same reason.
 *
 * `resolution` is the caller's ALREADY-COMPUTED `resolveScaleNet` result. The
 * caller passes the very object it persisted from, so the rendered net and the
 * stored net are the same number by construction. Recomputing here (it defaults
 * to the same call for pure-render callers) is the bug this fix removed.
 *
 * @param {{ gross: number, composition?: object }} args
 * @param {{ items?: Array<{id:string,label?:string,emoji?:string,grams:number}> }} containers
 * @param {ReturnType<typeof resolveScaleNet>} [resolution]
 * @returns {string}
 */
export function buildScalePromptText({ gross, composition = {} }, containers = { items: [] }, resolution = null) {
  const r = resolution || resolveScaleNet({ gross, composition }, containers);
  const lines = [densityPromptText(gross)];

  if (r.unknownId) {
    lines.push(`⚠️ unknown container "${r.unknownId}" — not tared`);
  } else if (r.error) {
    lines.push(`⚠️ container "${r.container?.id}" has no usable weight — not tared`);
  } else if (r.refused) {
    const name = r.container.label || r.container.id;
    lines.push(`⚠️ ${name} (${r.container.grams} g) is not lighter than the reading — not tared`);
  } else if (r.container) {
    lines[0] = `⚖️ ${gross} g gross`;
    lines.push(`➖ ${r.container.emoji || ''} ${r.container.label || r.container.id} (${r.container.grams} g)`.trim());
    lines.push(`= ${r.net} g net`);
  }

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
    const { userId, conversationId, grams, unit, scaleId, existingLogUuid, messageId, composition } = input;
    const gross = Math.round(Number(grams));
    if (!Number.isFinite(gross) || gross <= 0) {
      this.#logger.warn?.('logScale.badGrams', { scaleId, grams });
      return { success: false, error: 'bad grams' };
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
        const item0 = typeof existing.items[0].toJSON === 'function' ? existing.items[0].toJSON() : { ...existing.items[0] };
        const updated = existing.with({
          items: [{ ...item0, grams: net }],
          metadata: { ...existing.metadata, grossGrams: gross },
        }, new Date());
        await this.#foodLogStore.save(updated);
        const choices = buildDensityKeyboard(cfg, this.#encodeCallback, existingLogUuid);
        try {
          const editText = buildScalePromptText({ gross, composition }, cfg?.containers, resolution);
          await this.#messagingGateway.updateMessage(conversationId, messageId, { text: editText, choices, inline: true });
        } catch (e) {
          this.#logger.warn?.('logScale.editFailed', { error: e.message });
        }
        this.#logger.info?.('logScale.edited', { conversationId, logUuid: existingLogUuid, gross, net });
        return { success: true, logUuid: existingLogUuid, messageId: String(messageId), stage: 'density', edited: true };
      }
      // Touched / missing / non-pending: the user owns it now. The bridge's committed
      // flag handles the still-loaded food; posting a fresh prompt would duplicate. No-op.
      return { success: true, logUuid: existingLogUuid, edited: false, touched: true };
    }

    const timezone = this.#config?.getUserTimezone?.(userId) || 'America/Los_Angeles';
    const nutriLog = NutriLog.create({
      userId,
      conversationId,
      // NET, not gross: SelectScaleDensity multiplies this by kcal_per_g.
      items: [{ label: 'Unknown', grams: net, calories: 0, unit: unit || 'g', amount: 1, color: 'yellow' }],
      metadata: { source: 'scale', scaleId: scaleId || null, grossGrams: gross },
      timezone,
      timestamp: new Date(),
    });
    await this.#foodLogStore.save(nutriLog);

    const text = buildScalePromptText({ gross, composition }, cfg?.containers, resolution);
    const choices = buildDensityKeyboard(cfg, this.#encodeCallback, nutriLog.id);
    if (this.#conversationStateStore) {
      await this.#conversationStateStore.set(conversationId, {
        conversationId,
        activeFlow: 'scale_describe',
        flowState: { pendingLogUuid: nutriLog.id },
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
