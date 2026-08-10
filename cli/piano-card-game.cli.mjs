#!/usr/bin/env node
/**
 * Scale Stadium live readiness verifier.
 *
 * This is deliberately an end-to-end player, not a screenshot smoke test. It
 * verifies the deployed Pokémon definition and mounted corpus, opens the real
 * PianoKiosk route, feeds server-selected scales through the kiosk WebSocket
 * MIDI contract, and plays until Pikachu wins.
 *
 * Usage:
 *   node cli/piano-card-game.cli.mjs
 *   node cli/piano-card-game.cli.mjs --url https://daylightlocal.kckern.net/piano/games/card-game
 *   node cli/piano-card-game.cli.mjs --headed --screenshot /tmp/scale-stadium.png
 *   node cli/piano-card-game.cli.mjs --json
 */

import { mkdir } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import YAML from 'yaml';

export const DEFAULT_URL = 'https://daylightlocal.kckern.net/piano/games/card-game';
const DEFAULT_USER = 'guest';
const EXPECTED_PLAYER_MOVES = ['thunder-shock', 'spark', 'agility', 'light-screen', 'charge', 'iron-tail'];
const EXPECTED_ENEMY_MOVES = ['water-gun', 'withdraw', 'tail-whip', 'aqua-tail'];

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
    maxTurns: 12,
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

/** Validate the deployment contract before browser automation begins. */
export function inspectDefinitionPayload(payload) {
  const errors = [];
  const definition = payload?.definition;
  recordExpectation(errors, payload?.game_id === 'card-game', 'definition response must identify card-game');
  recordExpectation(errors, definition?.game_id === 'card-game', 'definition.game_id must be card-game');
  recordExpectation(errors, definition?.title === 'Scale Stadium', 'live title must be Scale Stadium');
  recordExpectation(errors, definition?.presentation?.theme === 'pokemon-tcg', 'live theme must be pokemon-tcg');
  recordExpectation(errors, definition?.presentation?.data_source === 'PokeAPI', 'live data source must be PokeAPI');

  const player = definition?.card_battle?.player;
  const enemy = definition?.card_battle?.enemy;
  const pikachu = player?.pokemon;
  const squirtle = enemy?.pokemon;
  recordExpectation(errors, player?.name === 'Pikachu', 'player must be Pikachu');
  recordExpectation(errors, player?.health === 35, 'Pikachu must use corpus HP 35');
  recordExpectation(errors, pikachu?.id === 25 && pikachu?.dex === '0025', 'Pikachu must use Pokédex #0025');
  recordExpectation(errors, sameArray(pikachu?.types, ['electric']), 'Pikachu must use the Electric type');
  recordExpectation(errors, pikachu?.stats?.speed === 90, 'Pikachu must use corpus Speed 90');
  recordExpectation(errors, pikachu?.assets?.svg === 'games/pokemon/svg/0025-pikachu-gen1.svg', 'Pikachu SVG path must match the corpus');
  recordExpectation(errors, enemy?.name === 'Squirtle', 'enemy must be Squirtle');
  recordExpectation(errors, enemy?.health === 44, 'Squirtle must use corpus HP 44');
  recordExpectation(errors, squirtle?.id === 7 && squirtle?.dex === '0007', 'Squirtle must use Pokédex #0007');
  recordExpectation(errors, sameArray(squirtle?.types, ['water']), 'Squirtle must use the Water type');
  recordExpectation(errors, squirtle?.stats?.defense === 65, 'Squirtle must use corpus Defense 65');
  recordExpectation(errors, squirtle?.assets?.svg === 'games/pokemon/svg/0007-squirtle-gen1.svg', 'Squirtle SVG path must match the corpus');
  recordExpectation(errors, enemy?.weakness?.type === 'electric' && enemy?.weakness?.multiplier === 1.5, 'Squirtle must have the authored Electric ×1.5 weakness');

  const cards = definition?.cards || {};
  for (const move of EXPECTED_PLAYER_MOVES) {
    const card = cards[move];
    recordExpectation(errors, Boolean(card), `move card ${move} must exist`);
    recordExpectation(errors, card?.challenge?.domain === 'piano' && card?.challenge?.kind === 'scale', `${move} must require a piano scale`);
    recordExpectation(errors, card?.challenge?.requirements?.curriculum === 'foundation-major-scales', `${move} must use the foundation major-scale curriculum`);
  }
  recordExpectation(errors, cards['thunder-shock']?.outcomes?.[0]?.multiplier === 1.5, 'fluent Thunder Shock must receive 150% power');
  recordExpectation(errors, cards['thunder-shock']?.outcomes?.[1]?.multiplier === 0.75, 'recovered Thunder Shock must receive 75% power');

  return {
    valid: errors.length === 0,
    errors,
    hash: payload?.definition_hash || null,
    definition,
    combatants: [
      { role: 'player', config: player, pokemon: pikachu, expectedMoves: EXPECTED_PLAYER_MOVES },
      { role: 'enemy', config: enemy, pokemon: squirtle, expectedMoves: EXPECTED_ENEMY_MOVES },
    ],
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

function corpusMoves(record) {
  return [...(record?.moves?.level_up || []), ...(record?.moves?.other || [])]
    .map((entry) => entry?.move)
    .filter(Boolean);
}

async function verifyCorpusAssets(origin, combatants, timeoutMs) {
  const verified = [];
  for (const { role, config, pokemon, expectedMoves } of combatants) {
    if (!pokemon?.source_file || !pokemon?.assets?.svg) throw new Error(`${role} Pokémon lacks corpus paths`);
    const sourceResponse = await checkedFetch(mediaUrl(origin, pokemon.source_file), { timeoutMs });
    const source = YAML.parse(await sourceResponse.text());
    if (source?.id !== pokemon.id || source?.dex !== pokemon.dex || source?.name !== pokemon.name) {
      throw new Error(`${pokemon.name} definition does not match ${pokemon.source_file}`);
    }
    if (!sameArray(source.types, pokemon.types)) throw new Error(`${pokemon.name} types do not match the corpus`);
    for (const [stat, value] of Object.entries(pokemon.stats || {})) {
      if (source?.stats?.[stat] !== value) throw new Error(`${pokemon.name} ${stat} does not match the corpus`);
    }
    if (!(source.abilities || []).some((ability) => ability.name === pokemon.ability)) {
      throw new Error(`${pokemon.name} ability ${pokemon.ability} is absent from the corpus`);
    }
    const moves = new Set(corpusMoves(source));
    for (const move of expectedMoves) {
      if (!moves.has(move)) throw new Error(`${pokemon.name} move ${move} is absent from the corpus`);
    }
    const svgResponse = await checkedFetch(mediaUrl(origin, pokemon.assets.svg), { timeoutMs, expectedType: 'image/svg+xml' });
    const svg = await svgResponse.text();
    if (!/<svg(?:\s|>)/i.test(svg)) throw new Error(`${pokemon.name} asset is not SVG markup`);
    verified.push({
      role,
      name: config.name,
      id: pokemon.id,
      dex: pokemon.dex,
      source: pokemon.source_file,
      svg: pokemon.assets.svg,
      moves: expectedMoves,
    });
  }
  return verified;
}

function installMidiBridge() {
  const NativeWebSocket = window.WebSocket;
  let bridgeSocket = null;

  class ReadinessBridgeSocket {
    constructor(url) {
      this.url = String(url);
      this.readyState = 0;
      bridgeSocket = this;
      window.setTimeout(() => {
        this.readyState = 1;
        this.onopen?.(new Event('open'));
      }, 0);
    }

    send() {}

    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.onclose?.({ code: 1000, reason: 'readiness verification complete' });
    }

    emit(frame) {
      if (this.readyState !== 1) throw new Error('Piano bridge is not connected');
      this.onmessage?.({ data: JSON.stringify(frame) });
    }
  }

  function ReadinessWebSocket(url, protocols) {
    if (String(url).startsWith('ws://localhost:8770')) return new ReadinessBridgeSocket(url);
    return protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
  }
  for (const name of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) ReadinessWebSocket[name] = NativeWebSocket[name];
  window.WebSocket = ReadinessWebSocket;
  window.localStorage.removeItem('gaming:card-game:guest:active-session');

  window.__scaleStadiumReadiness = {
    async playScale(notes) {
      if (!bridgeSocket) throw new Error('Piano bridge socket was not created');
      for (const note of notes) {
        bridgeSocket.emit({ type: 'note.on', note, velocity: 96 });
        await new Promise((resolve) => window.setTimeout(resolve, 18));
        bridgeSocket.emit({ type: 'note.off', note, velocity: 0 });
        await new Promise((resolve) => window.setTimeout(resolve, 12));
      }
    },
  };
}

function expectedAttackPower(card) {
  const weakness = card.moveType === 'electric' ? 1.5 : 1;
  return card.effect * weakness;
}

export function selectMove(cards, { energy, intentKind }) {
  const affordable = cards.filter((card) => card.cost <= energy);
  const attacks = affordable.filter((card) => card.type === 'attack');
  const charge = affordable.find((card) => card.title === 'Charge');
  if (charge && attacks.some((card) => card.cost <= energy - charge.cost)) return charge;
  if (attacks.length > 0) {
    return [...attacks].sort((left, right) => (
      expectedAttackPower(right) - expectedAttackPower(left)
      || left.cost - right.cost
      || left.title.localeCompare(right.title)
    ))[0];
  }
  if (intentKind === 'attack') {
    const guards = affordable.filter((card) => card.type === 'guard');
    if (guards.length > 0) return [...guards].sort((left, right) => right.effect - left.effect)[0];
  }
  return affordable.find((card) => card.type === 'focus') || null;
}

async function cardSnapshot(page) {
  return page.locator('.battle-card[data-card-instance-id]:not([disabled])').evaluateAll((buttons) => (
    buttons.map((button) => ({
      id: button.dataset.cardInstanceId,
      title: button.dataset.cardTitle,
      type: button.dataset.cardType,
      cost: Number(button.dataset.cardCost),
      effect: Number(button.dataset.cardEffect),
      moveType: button.dataset.moveType,
    }))
  ));
}

async function battleSnapshot(root) {
  const values = await root.evaluate((node) => ({
    status: node.dataset.battleStatus,
    winner: node.dataset.winner || null,
    turn: Number(node.dataset.turn),
    playerHealth: Number(node.dataset.playerHealth),
    playerEnergy: Number(node.dataset.playerEnergy),
    enemyHealth: Number(node.dataset.enemyHealth),
    theme: node.dataset.gameTheme,
  }));
  return values;
}

async function playCard({ page, root, card, timeoutMs }) {
  const before = await battleSnapshot(root);
  const selector = `.battle-card[data-card-instance-id=${JSON.stringify(card.id)}]`;
  const button = page.locator(selector);
  if (await button.count() !== 1) throw new Error(`card locator for ${card.id} was not unique`);
  const prepareResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith('/challenges/prepare')
  ), { timeout: timeoutMs });
  await button.click();
  const prepareResponse = await prepareResponsePromise;
  if (!prepareResponse.ok()) {
    const body = await prepareResponse.text();
    throw new Error(`${card.title} challenge preparation returned HTTP ${prepareResponse.status()}: ${body}`);
  }
  const prepared = await prepareResponse.json();
  const expectedMidi = prepared?.prompt?.expected_midi;
  if (!Array.isArray(expectedMidi) || expectedMidi.length < 2 || expectedMidi.some((note) => !Number.isInteger(note))) {
    throw new Error(`${card.title} challenge did not return a concrete MIDI scale`);
  }

  const overlay = page.locator('.gaming-challenge-overlay');
  await overlay.waitFor({ state: 'visible', timeout: timeoutMs });
  await page.locator('.piano-scale-note--next').waitFor({ state: 'visible', timeout: timeoutMs });
  const challengeTitle = (await page.locator('.piano-scale-challenge__heading strong').innerText()).trim();
  await page.evaluate((notes) => window.__scaleStadiumReadiness.playScale(notes), expectedMidi);
  await overlay.waitFor({ state: 'hidden', timeout: timeoutMs });

  const after = await battleSnapshot(root);
  const resolution = page.locator('.battle-resolution__effect');
  const effectiveness = await resolution.count() === 1 ? (await resolution.innerText()).trim() : null;
  return {
    card: card.title,
    cardType: card.type,
    scale: challengeTitle,
    expectedMidi,
    enemyHealthBefore: before.enemyHealth,
    enemyHealthAfter: after.enemyHealth,
    effectiveness,
    turn: before.turn,
  };
}

async function verifyViewport(page) {
  return page.evaluate(() => {
    const root = document.querySelector('main.card-battle--pokemon');
    const cards = [...document.querySelectorAll('.battle-card')];
    const boxes = cards.map((card) => {
      const box = card.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    });
    const withinViewport = boxes.every((box) => (
      box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight
    ));
    return {
      rootPresent: Boolean(root),
      width: window.innerWidth,
      height: window.innerHeight,
      cardCount: boxes.length,
      withinViewport,
      noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      noVerticalOverflow: document.documentElement.scrollHeight <= window.innerHeight,
    };
  });
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
  const consoleErrors = [];
  const apiFailures = [];
  let tracking = true;
  const target = new URL(options.url);
  target.searchParams.set('user', options.user);

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (!tracking) return;
    const url = new URL(response.url());
    if (url.origin === target.origin && url.pathname.startsWith('/api/') && response.status() >= 400) {
      apiFailures.push(`${response.request().method()} ${url.pathname} -> ${response.status()}`);
    }
  });
  page.on('requestfailed', (request) => {
    if (!tracking) return;
    const url = new URL(request.url());
    if (url.origin === target.origin && url.pathname.startsWith('/api/')) {
      apiFailures.push(`${request.method()} ${url.pathname} -> ${request.failure()?.errorText || 'request failed'}`);
    }
  });

  await page.addInitScript(installMidiBridge);
  const moves = [];
  let viewport = null;
  let final = null;
  try {
    progress(`Opening ${target.href}`);
    const response = await page.goto(target.href, { waitUntil: 'networkidle', timeout: options.timeoutMs });
    if (!response?.ok()) throw new Error(`game route returned HTTP ${response?.status() ?? 'unknown'}`);
    const root = page.locator('main.card-battle--pokemon');
    await root.waitFor({ state: 'visible', timeout: options.timeoutMs });
    if (await root.getAttribute('aria-label') !== 'Scale Stadium') throw new Error('browser did not render Scale Stadium');
    if (await root.getAttribute('data-game-theme') !== 'pokemon-tcg') throw new Error('browser did not render the Pokémon TCG theme');
    if (await page.getByLabel('Pikachu active Pokémon').count() !== 1) throw new Error('Pikachu active card is missing');
    if (await page.getByLabel('Squirtle active Pokémon').count() !== 1) throw new Error('Squirtle active card is missing');
    await page.waitForFunction(() => ['Pikachu', 'Squirtle'].every((name) => {
      const image = document.querySelector(`img[alt="${name}"]`);
      return image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
    }), null, { timeout: options.timeoutMs });

    viewport = await verifyViewport(page);
    if (viewport.cardCount !== 4) throw new Error(`opening hand rendered ${viewport.cardCount} cards instead of 4`);
    if (!viewport.withinViewport || !viewport.noHorizontalOverflow || !viewport.noVerticalOverflow) {
      throw new Error('battle does not fit the 1280×800 PianoKiosk viewport');
    }

    while (true) {
      const state = await battleSnapshot(root);
      if (state.status === 'complete') {
        final = state;
        break;
      }
      if (state.turn > options.maxTurns) throw new Error(`battle exceeded ${options.maxTurns} turns`);
      const cards = await cardSnapshot(page);
      const intent = page.locator('[data-intent-kind]');
      const intentKind = await intent.count() === 1 ? await intent.getAttribute('data-intent-kind') : null;
      const card = selectMove(cards, { energy: state.playerEnergy, intentKind });
      if (!card) {
        const endTurn = page.getByRole('button', { name: 'End turn', exact: true });
        if (await endTurn.count() !== 1) throw new Error('no playable move and End turn is unavailable');
        progress(`Turn ${state.turn}: Squirtle uses its announced move`);
        await endTurn.click();
        await page.waitForFunction((turn) => {
          const battle = document.querySelector('main.card-battle');
          return battle?.dataset.battleStatus === 'complete' || Number(battle?.dataset.turn) > turn;
        }, state.turn, { timeout: options.timeoutMs });
        continue;
      }

      progress(`Turn ${state.turn}: Pikachu uses ${card.title}`);
      const move = await playCard({ page, root, card, timeoutMs: options.timeoutMs });
      moves.push(move);
      if (card.type === 'attack' && move.enemyHealthAfter < move.enemyHealthBefore) {
        progress(`  ${move.scale}: ${move.enemyHealthBefore} → ${move.enemyHealthAfter} HP`);
      }
    }

    if (final?.winner !== 'player') throw new Error(`battle ended with winner ${final?.winner || 'unknown'}`);
    await page.getByText('You win!', { exact: true }).waitFor({ state: 'visible', timeout: options.timeoutMs });
    if (await page.getByRole('button', { name: /Oran Berry/ }).count() !== 1) throw new Error('Oran Berry reward is missing');
    if (await page.getByRole('button', { name: /Light Ball/ }).count() !== 1) throw new Error('Light Ball reward is missing');
    if (!moves.some((move) => move.cardType === 'attack' && move.enemyHealthAfter < move.enemyHealthBefore)) {
      throw new Error('playthrough never dealt attack damage');
    }
    if (!moves.some((move) => move.effectiveness?.includes('Fluent') || move.effectiveness?.includes('Super effective'))) {
      throw new Error('playthrough did not surface a fluent move outcome');
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
      challengeCount: moves.length,
      consoleErrors,
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
    onProgress('Checking the live card-game definition');
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
    if (!inspected.valid) throw new Error(`live definition is not Scale Stadium: ${inspected.errors.join('; ')}`);

    onProgress('Checking mounted Pokémon YAML and SVG assets');
    report.assets = await verifyCorpusAssets(origin, inspected.combatants, options.timeoutMs);
    onProgress('Playing a complete MIDI-powered battle');
    report.browser = await verifyBrowser(options, onProgress);
    report.valid = true;
  } catch (error) {
    report.errors.push(error?.message || String(error));
  }
  report.durationMs = Date.now() - startedAt;
  return report;
}

const USAGE = `Scale Stadium live readiness verifier

  node cli/piano-card-game.cli.mjs [options]

Options:
  --url <url>          Game route (default ${DEFAULT_URL})
  --user <id>          Isolated attempt identity (default ${DEFAULT_USER})
  --timeout <seconds>  Per-operation timeout (default 30)
  --max-turns <count>  Fail if the battle runs longer (default 12)
  --screenshot <path>  Save the victory screen (also captures failures)
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
    process.stdout.write(`✓ Scale Stadium is ready at ${report.url}\n`);
    process.stdout.write(`  ${report.assets.map((asset) => `${asset.name} #${asset.dex}`).join(' vs ')}\n`);
    process.stdout.write(`  Won in ${report.browser.final.turn} turns with ${report.browser.challengeCount} completed scales; ${report.browser.final.playerHealth} HP remained.\n`);
    if (report.browser.screenshot) process.stdout.write(`  Screenshot: ${report.browser.screenshot}\n`);
  } else {
    process.stderr.write(`✗ Scale Stadium readiness failed\n  ${report.errors.join('\n  ')}\n`);
  }
  if (!report.valid) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    process.stderr.write(`✗ ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
