#!/usr/bin/env node
/**
 * Card Game live readiness verifier.
 *
 * Verifies the deployed journey contract and Pokémon SVGs, then uses the real
 * PianoKiosk MIDI bridge to complete all three encounters with all four piano
 * skill families represented in the run.
 */

import { mkdir } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

export const DEFAULT_URL = 'https://daylightlocal.kckern.net/piano/games/card-game';
const DEFAULT_USER = 'guest';
const EXPECTED_PARTNERS = ['bulbasaur', 'charmander', 'squirtle'];
const EXPECTED_OPPONENTS = ['pidgey', 'meowth', 'snorlax'];
const EXPECTED_SKILLS = ['scale', 'chord', 'arpeggio', 'timed-pattern'];
const EXPECTED_HITS = ['bullseye', 'direct-hit', 'partial-hit', 'miss'];

function requiredValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

function positiveNumber(value, option) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${option} must be a positive number`);
  return parsed;
}

export function parseArgs(argv) {
  const options = {
    url: DEFAULT_URL,
    user: DEFAULT_USER,
    headed: false,
    json: false,
    screenshot: null,
    timeoutMs: 30_000,
    maxTurns: 30,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--url') options.url = requiredValue(argv, index++, token);
    else if (token === '--user') options.user = requiredValue(argv, index++, token);
    else if (token === '--timeout') options.timeoutMs = positiveNumber(requiredValue(argv, index++, token), token) * 1000;
    else if (token === '--max-turns') options.maxTurns = positiveNumber(requiredValue(argv, index++, token), token);
    else if (token === '--screenshot') options.screenshot = resolvePath(requiredValue(argv, index++, token));
    else if (token === '--headed') options.headed = true;
    else if (token === '--json') options.json = true;
    else if (token === '--help' || token === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  const target = new URL(options.url);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('--url must use http or https');
  options.url = target.href;
  return options;
}

function recordExpectation(errors, condition, message) {
  if (!condition) errors.push(message);
}

function sameArray(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

/** Validate the deployed journey before browser automation begins. */
export function inspectDefinitionPayload(payload) {
  const errors = [];
  const definition = payload?.definition;
  recordExpectation(errors, payload?.game_id === 'card-game', 'definition response must identify card-game');
  recordExpectation(errors, definition?.game_id === 'card-game', 'definition.game_id must be card-game');
  recordExpectation(errors, definition?.title === 'Card Game', 'live title must be Card Game');
  recordExpectation(errors, definition?.ruleset === 'pokemon-practice-journey-v1', 'live ruleset must be pokemon-practice-journey-v1');
  recordExpectation(errors, definition?.view_id === 'pokemon-practice-journey-v1', 'live view must be pokemon-practice-journey-v1');
  recordExpectation(errors, definition?.presentation?.theme === 'pokemon-stadium', 'live theme must be pokemon-stadium');
  recordExpectation(errors, definition?.presentation?.data_source === 'PokeAPI', 'live data source must be PokeAPI');
  recordExpectation(errors, sameArray(definition?.journey?.partners?.map((entry) => entry.id), EXPECTED_PARTNERS), 'journey must offer the three authored partners');
  recordExpectation(errors, sameArray(definition?.journey?.opponents?.map((entry) => entry.id), EXPECTED_OPPONENTS), 'journey must contain Pidgey, Meowth, and Snorlax');
  recordExpectation(errors, definition?.journey?.opponent_tiers?.length === 5, 'journey must define five escalating opponent tiers');
  recordExpectation(errors, definition?.journey?.opponent_tiers?.every((tier) => tier.pool?.length >= 2), 'every route tier must offer at least two authored opponents');
  recordExpectation(errors, definition?.journey?.gym?.opponents?.length === 4, 'gym must contain four themed opponents');

  const cards = definition?.cards || {};
  for (const partner of definition?.journey?.partners || []) {
    const moves = (partner.move_ids || []).map((moveId) => cards[moveId]);
    recordExpectation(errors, sameArray(moves.map((move) => move?.challenge?.kind), EXPECTED_SKILLS), `${partner.name} must map one move to each piano skill`);
    for (const [index, move] of moves.entries()) {
      recordExpectation(errors, move?.challenge?.domain === 'piano', `${partner.name} move ${index + 1} must use Piano`);
      recordExpectation(errors, move?.challenge?.requirements?.curriculum === 'pokemon-journey-foundations', `${partner.name} move ${index + 1} must use the journey curriculum`);
      recordExpectation(errors, sameArray(move?.outcomes?.map((outcome) => outcome.id), EXPECTED_HITS), `${partner.name} move ${index + 1} must grade bullseye/direct/partial/miss`);
    }
  }

  const combatants = [
    ...(definition?.journey?.partners || []).map((pokemon) => ({ role: 'partner', pokemon })),
    ...(definition?.journey?.opponent_tiers || []).flatMap((tier) => tier.pool || []).map((pokemon) => ({ role: 'route opponent', pokemon })),
    ...(definition?.journey?.gym?.opponents || []).map((pokemon) => ({ role: 'gym opponent', pokemon })),
  ];
  return {
    valid: errors.length === 0,
    errors,
    hash: payload?.definition_hash || null,
    definition,
    combatants,
  };
}

function mediaUrl(origin, path) {
  return new URL(`/api/v1/proxy/media/stream/${encodeURIComponent(path)}`, origin).href;
}

async function checkedFetch(url, { timeoutMs, expectedType = null } = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (expectedType && !contentType.toLowerCase().includes(expectedType.toLowerCase())) {
    throw new Error(`${url} returned ${contentType || 'no content type'}, expected ${expectedType}`);
  }
  return response;
}

async function verifyCorpusAssets(origin, combatants, timeoutMs) {
  const verified = [];
  for (const { role, pokemon } of combatants) {
    if (!pokemon?.asset) throw new Error(`${pokemon?.name || role} lacks a corpus SVG path`);
    const response = await checkedFetch(mediaUrl(origin, pokemon.asset), { timeoutMs, expectedType: 'image/svg+xml' });
    const svg = await response.text();
    if (!/<svg(?:\s|>)/i.test(svg)) throw new Error(`${pokemon.name} asset is not SVG markup`);
    verified.push({ role, name: pokemon.name, dex: pokemon.dex, svg: pokemon.asset });
  }
  return verified;
}

function installMidiBridge() {
  const NativeWebSocket = window.WebSocket;
  const bridgeSockets = new Set();
  let bridgeEnabled = true;
  let emittedFrames = 0;
  const devKeyByMidi = new Map([
    [60, '1'], [62, '2'], [64, '3'], [65, '4'], [67, '5'], [69, '6'],
    [71, '7'], [72, '8'], [74, '9'], [76, '0'], [77, '-'], [79, '='],
  ]);

  class ReadinessBridgeSocket {
    constructor(url) {
      this.url = String(url);
      this.readyState = 0;
      bridgeSockets.add(this);
      window.setTimeout(() => {
        if (!bridgeEnabled) {
          bridgeSockets.delete(this);
          this.readyState = 3;
          this.onerror?.(new Event('error'));
          this.onclose?.({ code: 1006, reason: 'local readiness virtual input' });
          return;
        }
        this.readyState = 1;
        this.onopen?.(new Event('open'));
      }, 0);
    }

    send() {}

    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      bridgeSockets.delete(this);
      this.onclose?.({ code: 1000, reason: 'readiness verification complete' });
    }

    emit(frame) {
      if (this.readyState !== 1) throw new Error('Piano bridge is not connected');
      emittedFrames += 1;
      this.onmessage?.call(this, new MessageEvent('message', { data: JSON.stringify(frame) }));
    }
  }

  function ReadinessWebSocket(url, protocols) {
    if (String(url).startsWith('ws://localhost:8770')) return new ReadinessBridgeSocket(url);
    return protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
  }
  for (const name of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) ReadinessWebSocket[name] = NativeWebSocket[name];
  window.WebSocket = ReadinessWebSocket;
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith('gaming:card-game:') && key.endsWith(':active-session')) window.localStorage.removeItem(key);
  }

  const pause = (duration) => new Promise((resolve) => window.setTimeout(resolve, duration));
  window.__scaleStadiumReadiness = {
    disableBridge() {
      bridgeEnabled = false;
      for (const socket of [...bridgeSockets]) socket.close();
    },
    bridgeStatus() {
      const active = [...bridgeSockets].filter((socket) => socket.readyState === 1);
      return { emittedFrames, activeSockets: active.length, messageHandlers: active.filter((socket) => socket.onmessage).length };
    },
    async playPrompt(kind, prompt, assessmentStartedAt = null) {
      const emit = (frame) => {
        const active = [...bridgeSockets].filter((socket) => socket.readyState === 1);
        if (active.length === 0) throw new Error('Piano bridge socket was not created');
        for (const socket of active) socket.emit(frame);
      };
      const noteOn = (midi) => {
        const key = window.location.hostname === 'localhost' ? devKeyByMidi.get(midi) : null;
        if (key) window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        else emit({ type: 'note.on', note: midi, velocity: 96 });
      };
      const noteOff = (midi) => {
        const key = window.location.hostname === 'localhost' ? devKeyByMidi.get(midi) : null;
        if (key) window.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
        else emit({ type: 'note.off', note: midi, velocity: 0 });
      };
      const events = prompt.expected_events;
      if (kind === 'chord') {
        for (const event of events) for (const note of event.notes || []) {
          noteOn(note.midi);
          await pause(150);
        }
        return;
      }
      const beatMs = prompt.tempo_bpm ? 60_000 / prompt.tempo_bpm : 35;
      for (const [index, event] of events.entries()) {
        const offset = Number.isFinite(event.onsetQuarter) ? event.onsetQuarter * beatMs : index * beatMs;
        const target = Number.isFinite(assessmentStartedAt)
          ? assessmentStartedAt + (prompt.lead_in_ms || 0) + offset
          : Date.now() + (index === 0 ? (prompt.lead_in_ms || 0) : Math.max(18, beatMs));
        await pause(Math.max(0, target - Date.now()));
        for (const note of event.notes || []) noteOn(note.midi);
        await pause(18);
        for (const note of event.notes || []) noteOff(note.midi);
      }
    },
    releaseNotes(notes) {
      if (window.location.hostname === 'localhost') {
        for (const note of notes) {
          const key = devKeyByMidi.get(note);
          if (key) window.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
        }
        return;
      }
      const active = [...bridgeSockets].filter((socket) => socket.readyState === 1);
      for (const note of notes) for (const socket of active) socket.emit({ type: 'note.off', note, velocity: 0 });
    },
  };
}

async function playVirtualPrompt(page, kind, prompt, assessmentStartedAt = null) {
  const events = prompt.expected_events;
  const beatMs = prompt.tempo_bpm ? 60_000 / prompt.tempo_bpm : 35;
  for (const [index, event] of events.entries()) {
    const offset = Number.isFinite(event.onsetQuarter) ? event.onsetQuarter * beatMs : index * beatMs;
    const pageNow = await page.evaluate(() => Date.now());
    const target = Number.isFinite(assessmentStartedAt)
      ? assessmentStartedAt + (prompt.lead_in_ms || 0) + offset
      : pageNow + (index === 0 ? (prompt.lead_in_ms || 0) : Math.max(18, beatMs));
    await page.waitForTimeout(Math.max(0, target - pageNow));
    for (const note of event.notes || []) {
      const selector = `.piano-challenge__virtual-input .piano-key[data-note="${note.midi}"]`;
      const key = await page.$(selector);
      if (!key) {
        if (!await page.locator('.journey-practice').isVisible()) return;
        throw new Error(`virtual piano lacks MIDI ${note.midi}`);
      }
      await key.dispatchEvent('pointerdown', { pointerId: 1 });
    }
    if (kind !== 'chord') {
      await page.waitForTimeout(18);
      for (const note of event.notes || []) {
        const key = await page.$(`.piano-challenge__virtual-input .piano-key[data-note="${note.midi}"]`);
        if (key) await key.dispatchEvent('pointerup', { pointerId: 1 });
      }
    }
  }
}

/** Prefer unseen piano skills, then the strongest available move. */
export function selectMove(moves, { usedKinds = new Set() } = {}) {
  const unseen = moves.filter((move) => !usedKinds.has(move.kind));
  const candidates = unseen.length > 0 ? unseen : moves;
  return [...candidates].sort((left, right) => right.damage - left.damage || left.title.localeCompare(right.title))[0] || null;
}

export function isResumeJourneyLabel(label) {
  return /^(?:Continue journey|Resume campaign)$/i.test(String(label).trim());
}

async function moveSnapshot(page) {
  return page.locator('.journey-move[data-move-id]:not([disabled])').evaluateAll((buttons) => (
    buttons.map((button) => ({
      id: button.dataset.moveId,
      title: button.querySelector('strong')?.textContent?.trim() || button.dataset.moveId,
      kind: button.dataset.skillKind,
      damage: Number(button.dataset.damage),
    }))
  ));
}

async function journeySnapshot(root) {
  return root.evaluate((node) => ({
    status: node.dataset.battleStatus,
    phase: node.dataset.journeyPhase,
    encounter: node.dataset.encounter,
    partner: node.dataset.partner,
    turn: Number(node.dataset.turn),
    playerHealth: Number(node.dataset.playerHealth),
    enemyHealth: Number(node.dataset.enemyHealth),
    score: Number(node.dataset.score),
  }));
}

async function playMove({ page, root, move, timeoutMs }) {
  const before = await journeySnapshot(root);
  const button = page.locator(`.journey-move[data-move-id=${JSON.stringify(move.id)}]`);
  if (await button.count() !== 1) throw new Error(`move locator for ${move.id} was not unique`);
  const prepareResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith('/challenges/prepare')
  ), { timeout: timeoutMs });
  const deadline = Date.now() + timeoutMs;
  let prepareResponse = null;
  while (!prepareResponse && Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    try {
      await button.click({ timeout: Math.min(250, remaining) });
    } catch (error) {
      // An accepted click removes the move while the prepare response is still
      // in flight. Retry only actionability timeouts and preserve real errors.
      if (error?.name !== 'TimeoutError') throw error;
    }
    prepareResponse = await Promise.race([
      prepareResponsePromise,
      page.waitForTimeout(Math.min(100, Math.max(1, deadline - Date.now()))).then(() => null),
    ]);
  }
  prepareResponse ||= await prepareResponsePromise;
  if (!prepareResponse.ok()) {
    const body = await prepareResponse.text();
    throw new Error(`${move.title} preparation returned HTTP ${prepareResponse.status()}: ${body}`);
  }
  const prepared = await prepareResponse.json();
  const expectedEvents = prepared?.prompt?.expected_events;
  const expectedNotes = expectedEvents?.flatMap((event) => event.notes || []) || [];
  if (!Array.isArray(expectedEvents) || expectedEvents.length === 0 || expectedNotes.length < 2) {
    throw new Error(`${move.title} did not materialize playable expected_events`);
  }
  const panel = page.locator('.journey-practice');
  await panel.waitFor({ state: 'visible', timeout: timeoutMs });
  const localVirtual = ['localhost', '127.0.0.1'].includes(new URL(page.url()).hostname);
  if (localVirtual) {
    await page.evaluate(() => window.__scaleStadiumReadiness.disableBridge());
    await page.locator('.piano-challenge__virtual-input').waitFor({ state: 'visible', timeout: timeoutMs });
  }
  const challengeTitle = (await page.locator('.piano-scale-challenge__heading strong, .piano-challenge__chord').innerText()).trim();
  if (move.kind === 'chord') {
    // A chord attempt intentionally begins only after the provider has seen an
    // empty keyboard. This mirrors the player's natural read-then-play beat and
    // proves a chord held before the prompt cannot auto-complete the challenge.
    await page.locator('.piano-challenge[data-chord-armed="true"]').waitFor({
      state: 'visible', timeout: timeoutMs,
    });
  } else {
    await page.locator('.piano-scale-challenge[data-input-ready="true"]').waitFor({
      state: 'visible', timeout: timeoutMs,
    });
  }
  const assessmentStartedAt = Number(await page.locator('.piano-challenge').getAttribute('data-assessment-started-at'));
  if (localVirtual) await playVirtualPrompt(page, move.kind, prepared.prompt, assessmentStartedAt);
  else {
    await page.evaluate(({ kind, prompt, startedAt }) => window.__scaleStadiumReadiness.playPrompt(kind, prompt, startedAt), {
      kind: move.kind, prompt: prepared.prompt, startedAt: assessmentStartedAt,
    });
  }
  try {
    await panel.waitFor({ state: 'hidden', timeout: timeoutMs });
  } catch (error) {
    const challengeSurface = page.locator('.piano-challenge');
    const diagnostic = await challengeSurface.count() > 0
      ? await challengeSurface.evaluate((node) => ({
        dataset: { ...node.dataset },
        feedback: node.querySelector('.piano-scale-challenge__feedback')?.textContent?.trim() || null,
      }))
      : null;
    const bridgeDiagnostic = await page.evaluate(() => window.__scaleStadiumReadiness.bridgeStatus());
    throw new Error(`${error.message}${diagnostic ? `; challenge diagnostic ${JSON.stringify(diagnostic)}` : ''}; bridge diagnostic ${JSON.stringify(bridgeDiagnostic)}`);
  } finally {
    if (move.kind === 'chord' && localVirtual) {
      for (const note of prepared.prompt.expected_events.flatMap((event) => event.notes || [])) {
        const key = page.locator(`.piano-challenge__virtual-input .piano-key[data-note="${note.midi}"]`);
        if (await key.count() === 1) {
          await key.evaluate((node) => node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 })));
        }
      }
    } else if (move.kind === 'chord') {
      await page.evaluate(
        (events) => window.__scaleStadiumReadiness.releaseNotes(events.flatMap((event) => (event.notes || []).map((note) => note.midi))),
        prepared.prompt.expected_events,
      );
    }
  }
  // The authoritative result hides the panel just before chooseAction's
  // in-flight guard clears; allow that final promise microtask to settle.
  await page.waitForTimeout(100);
  const after = await journeySnapshot(root);
  const feedback = page.locator('.journey-hit strong');
  return {
    move: move.title,
    kind: move.kind,
    challenge: challengeTitle,
    encounter: before.encounter,
    enemyHealthBefore: before.enemyHealth,
    enemyHealthAfter: after.enemyHealth,
    hit: await feedback.count() === 1 ? (await feedback.innerText()).trim() : null,
  };
}

async function verifyViewport(page, selector) {
  return page.evaluate((rootSelector) => {
    const root = document.querySelector(rootSelector);
    const boxes = [...(root?.querySelectorAll('button') || [])].map((button) => button.getBoundingClientRect());
    return {
      rootPresent: Boolean(root),
      width: window.innerWidth,
      height: window.innerHeight,
      buttonCount: boxes.length,
      withinViewport: boxes.every((box) => box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight),
      noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      noVerticalOverflow: document.documentElement.scrollHeight <= window.innerHeight,
    };
  }, selector);
}

async function verifyBrowser(options, progress) {
  const browser = await chromium.launch({
    headless: !options.headed,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const pageErrors = [];
  const apiFailures = [];
  let tracking = true;
  const target = new URL(options.url);
  target.searchParams.set('user', options.user);
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
    progress(`Page error: ${error.message}`);
  });
  page.on('response', (response) => {
    if (!tracking) return;
    const url = new URL(response.url());
    if (url.origin === target.origin && url.pathname.startsWith('/api/') && response.status() >= 400) {
      apiFailures.push(`${response.request().method()} ${url.pathname} -> ${response.status()}`);
    }
  });

  await page.addInitScript(installMidiBridge);
  const moves = [];
  const usedKinds = new Set();
  let viewport = null;
  let final = null;
  try {
    progress(`Opening ${target.href}`);
    const response = await page.goto(target.href, { waitUntil: 'networkidle', timeout: options.timeoutMs });
    if (!response?.ok()) throw new Error(`game route returned HTTP ${response?.status() ?? 'unknown'}`);
    const hub = page.locator('main.journey-hub');
    await hub.waitFor({ state: 'visible', timeout: options.timeoutMs });
    viewport = await verifyViewport(page, 'main.journey-hub');
    if (!viewport.withinViewport || !viewport.noHorizontalOverflow || !viewport.noVerticalOverflow) {
      throw new Error('home dashboard does not fit the 1280×800 PianoKiosk viewport');
    }
    const launchButton = page.getByRole('button', {
      name: /Continue journey|Choose a partner|Play again|Resume campaign|Start chapter|Replay chapter/,
    });
    const resuming = isResumeJourneyLabel(await launchButton.innerText());
    await launchButton.click();
    if (!resuming) {
      const lobby = page.locator('main.journey-lobby');
      await lobby.waitFor({ state: 'visible', timeout: options.timeoutMs });
      const lobbyViewport = await verifyViewport(page, 'main.journey-lobby');
      if (!lobbyViewport.withinViewport || !lobbyViewport.noHorizontalOverflow || !lobbyViewport.noVerticalOverflow) {
        throw new Error('partner lobby does not fit the 1280×800 PianoKiosk viewport');
      }
      await page.waitForFunction(() => ['Bulbasaur', 'Charmander', 'Squirtle'].every((name) => {
        const image = document.querySelector(`.journey-starter img[src*="${name.toLowerCase()}"]`);
        return image?.complete && image.naturalWidth > 0;
      }), null, { timeout: options.timeoutMs });
      await page.getByRole('button', { name: /Bulbasaur/ }).click();
    }

    const root = page.locator('main.journey-battle');
    await root.waitFor({ state: 'visible', timeout: options.timeoutMs });
    // A restored session may be refunding an interrupted pending action during
    // the first render. Let that command settle before selecting a fresh move.
    await page.waitForTimeout(750);
    while (moves.length < options.maxTurns) {
      const state = await journeySnapshot(root);
      if (state.phase === 'complete') {
        final = state;
        break;
      }
      if (state.phase === 'checkpoint') {
        progress(`Cleared ${state.encounter}; continuing the journey`);
        let continued = false;
        for (let attempt = 0; attempt < 3 && !continued; attempt += 1) {
          await page.waitForTimeout(attempt === 0 ? 300 : 500);
          await page.getByRole('button', { name: /^Continue/ }).click();
          try {
            await page.waitForFunction(
              (encounter) => document.querySelector('main.journey-battle')?.dataset.encounter !== encounter,
              state.encounter,
              { timeout: Math.min(options.timeoutMs, 5_000) },
            );
            continued = true;
          } catch (error) {
            if (attempt === 2) throw error;
          }
        }
        continue;
      }
      if (state.phase === 'recruitment') {
        await page.getByRole('button', { name: /^Recruit / }).first().click();
        continue;
      }
      if (state.phase === 'gym-entry') {
        await page.getByRole('button', { name: 'Enter Gym' }).click();
        continue;
      }
      if (state.phase === 'chapter-summary') {
        await page.getByRole('button', { name: 'See badge' }).click();
        continue;
      }
      if (state.phase === 'ceremony') {
        const continueButton = page.getByRole('button', { name: /^Continue/ });
        await continueButton.waitFor({ state: 'visible' });
        await continueButton.click();
        continue;
      }
      if (state.phase === 'final-report') {
        await page.getByRole('button', { name: /^Continue/ }).click();
        continue;
      }
      if (state.phase === 'defeated') {
        progress(`Defeated by ${state.encounter}; retrying with preserved practice evidence`);
        await page.getByRole('button', { name: /^Retry / }).click();
        continue;
      }
      const available = await moveSnapshot(page);
      const selected = selectMove(available, { usedKinds });
      if (!selected) throw new Error('battle offered no playable piano move');
      progress(`${state.encounter}: ${selected.title} (${selected.kind})`);
      const played = await playMove({ page, root, move: selected, timeoutMs: options.timeoutMs });
      moves.push(played);
      usedKinds.add(selected.kind);
    }

    if (!final) throw new Error(`journey exceeded ${options.maxTurns} piano performances`);
    if (final.status !== 'complete') throw new Error(`journey ended with status ${final.status}`);
    for (const kind of EXPECTED_SKILLS) {
      if (!usedKinds.has(kind)) throw new Error(`playthrough did not exercise ${kind}`);
    }
    await page.getByText('Journey complete!', { exact: true }).waitFor({ state: 'visible', timeout: options.timeoutMs });
    const battleViewport = await verifyViewport(page, 'main.journey-battle');
    if (!battleViewport.withinViewport || !battleViewport.noHorizontalOverflow || !battleViewport.noVerticalOverflow) {
      throw new Error('journey summary does not fit the 1280×800 PianoKiosk viewport');
    }
    if (options.screenshot) {
      await mkdir(dirname(options.screenshot), { recursive: true });
      await page.screenshot({ path: options.screenshot, fullPage: true });
    }
    if (pageErrors.length > 0) throw new Error(`page errors: ${pageErrors.join('; ')}`);
    if (apiFailures.length > 0) throw new Error(`API failures: ${apiFailures.join('; ')}`);
    return {
      route: target.href,
      viewport,
      final,
      moves,
      skillFamilies: [...usedKinds],
      challengeCount: moves.length,
      pageErrors,
      apiFailures,
      screenshot: options.screenshot,
    };
  } finally {
    tracking = false;
    if (options.screenshot && !final) {
      await mkdir(dirname(options.screenshot), { recursive: true }).catch(() => {});
      await page.screenshot({ path: options.screenshot, fullPage: true }).catch(() => {});
    }
    await context.close();
    await browser.close();
  }
}

export async function verifyPianoCardGame(options, { onProgress = () => {} } = {}) {
  const startedAt = Date.now();
  const report = {
    valid: false,
    url: options.url,
    checkedAt: new Date(startedAt).toISOString(),
    durationMs: null,
    definition: null,
    assets: [],
    browser: null,
    errors: [],
  };
  try {
    const origin = new URL(options.url).origin;
    onProgress('Checking the live card-game journey definition');
    const definitionResponse = await checkedFetch(new URL('/api/v1/gaming/definitions/card-game', origin), {
      timeoutMs: options.timeoutMs,
      expectedType: 'application/json',
    });
    const inspected = inspectDefinitionPayload(await definitionResponse.json());
    report.definition = {
      valid: inspected.valid,
      hash: inspected.hash,
      title: inspected.definition?.title || null,
      theme: inspected.definition?.presentation?.theme || null,
      errors: inspected.errors,
    };
    if (!inspected.valid) throw new Error(`live definition is not Card Game: ${inspected.errors.join('; ')}`);

    onProgress('Checking mounted Pokémon SVG assets');
    report.assets = await verifyCorpusAssets(origin, inspected.combatants, options.timeoutMs);
    onProgress('Playing the complete MIDI-powered journey');
    report.browser = await verifyBrowser(options, onProgress);
    report.valid = true;
  } catch (error) {
    report.errors.push(error?.message || String(error));
  }
  report.durationMs = Date.now() - startedAt;
  return report;
}

const USAGE = `Card Game live readiness verifier

  node cli/piano-card-game.cli.mjs [options]

Options:
  --url <url>          Game route (default ${DEFAULT_URL})
  --user <id>          Practice identity (default ${DEFAULT_USER})
  --timeout <seconds>  Per-operation timeout (default 30)
  --max-turns <count>  Maximum piano performances (default 30)
  --screenshot <path>  Save the journey summary (also captures failures)
  --headed             Show Chromium while the verifier plays
  --json               Machine-readable report on stdout
  -h, --help           Show this help
`;

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`✗ ${error.message}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }
  const progress = options.json ? () => {} : (message) => process.stderr.write(`• ${message}\n`);
  const report = await verifyPianoCardGame(options, { onProgress: progress });
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else if (report.valid) {
    process.stdout.write(`✓ Card Game is ready at ${report.url}\n`);
    process.stdout.write(`  Verified ${report.assets.length} Pokémon assets and ${report.browser.skillFamilies.length} piano skill families.\n`);
    process.stdout.write(`  Completed the route and gym in ${report.browser.challengeCount} performances with score ${report.browser.final.score}.\n`);
    if (report.browser.screenshot) process.stdout.write(`  Screenshot: ${report.browser.screenshot}\n`);
  } else {
    process.stderr.write(`✗ Card Game readiness failed\n  ${report.errors.join('\n  ')}\n`);
  }
  if (!report.valid) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    process.stderr.write(`✗ ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
