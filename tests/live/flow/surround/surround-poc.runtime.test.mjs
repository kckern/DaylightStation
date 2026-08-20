// tests/live/flow/surround/surround-poc.runtime.test.mjs
//
// Runtime gate for the player surround (the concert-hall programme frame).
//
// WHAT THIS GATE IS FOR
// ---------------------
// Every other test in the feature is a unit test against a mocked player handle.
// This is the only one that proves the seam is wired to a REAL Player, against
// the REAL backend, with the REAL authored sidecars — which is exactly where the
// feature can be broken without a single unit test going red.
//
// The five cases below map one-to-one onto the five ways the feature fails:
//
//   1. the frame never mounts, or mounts and distorts the video
//   2. the frame mounts but its clock is not the video's clock (seek desync)
//   3. the programme text is static furniture rather than playhead-driven
//   4. an un-enriched item pays for the feature anyway (a wrapper it never needed)
//   5. ONE of the two player seams is wrapped and the other is not
//
// Case 5 is the reason this file exists in its current shape. Playback starts in
// two independent places — `ScreenPlayer` (URL/WS-triggered) and `MenuStack`
// (menu-selected) — and an earlier design wrapped only the first. Cases 1 and 5
// pass through the SAME assertions by two different routes on purpose.
//
// PRECONDITIONS FAIL, THEY DO NOT SKIP
// ------------------------------------
// Per CLAUDE.md: "Skipping is NOT passing." If the backend is down, or the
// authored sidecar no longer binds to the fixture item, `beforeAll` throws with
// a message naming exactly what went stale. It never quietly passes.

import { test, expect } from '@playwright/test';
import { FRONTEND_URL, BACKEND_URL } from '#fixtures/runtime/urls.mjs';

// ---------------------------------------------------------------------------
// Fixtures — authored content, not invented for the test.
// ---------------------------------------------------------------------------

/** Vivaldi, "Spring" (Slow TV S01E01). Authored sidecar: classical/vivaldi/four-seasons-spring.yml */
const ENRICHED_ID = 'plex:663146';
/**
 * The show the enriched item lives under — the menu the second seam is driven
 * through. `?list=` opens a menu at ITS OWN level, and only a season SELECTED
 * from a show carries `type: 'season'`, which is what makes MenuStack push the
 * episode grid. Opening the season id (plex:663145) directly lands a level too
 * low — it lists itself — so the seam is driven from the show above it.
 */
const SHOW_ID = 'plex:663144';
/** Vivaldi, "Summer" (S01E02). Same show, same library, deliberately NOT authored. */
const PLAIN_ID = 'plex:663147';

/** From the sidecar's `piece.musicEndsAt` — the MovementMap's rule ends here, not at `duration`. */
const MUSIC_ENDS_AT = 613;
/** From the sidecar's `movements[].start`. */
const MOVEMENT_STARTS = [0, 225, 385];
/**
 * From the sidecar's `movements[].name`. Design wave 6 split the band's text
 * zone in two and the right-hand register names the movement that is actually
 * sounding, so the gate now has to know what those names ARE to check that the
 * register is reading the transport rather than printing furniture.
 */
const MOVEMENT_NAMES = ['Allegro', 'Largo e pianissimo sempre', 'Allegro pastorale'];
/** The sidecar's first cue is at 0s with the default 12s dwell. */
const FIRST_CUE_AT = 0;
const CUE_DWELL_S = 12;
const FIRST_CUE_SNIPPET = 'Spring has arrived';

const HD = { width: 1920, height: 1080 };
/**
 * What "the media mounted" looks like in the DOM. dash playback renders a
 * <dash-video> CUSTOM ELEMENT that carries the real <video> inside its SHADOW
 * ROOT, so this selector matches TWO nodes for one video — Playwright's engine
 * pierces open shadow roots, and counts both the host and the element inside it.
 * Use it to WAIT for playback to exist; never to count playable elements.
 */
const MEDIA_SEL = 'video, dash-video';
/**
 * The one real HTMLMediaElement. `document.querySelector('video')` inside
 * page.evaluate CANNOT see it — script in the page does not pierce shadow roots,
 * which is why the transport helpers below drive it through a Playwright locator
 * instead of through a document query.
 */
const PLAYABLE_SEL = 'video';

// ---------------------------------------------------------------------------
// Preflight — resolved once, asserted loudly.
// ---------------------------------------------------------------------------

let enrichedPlay = null;

async function getPlay(contentId) {
  const url = `${BACKEND_URL}/api/v1/play/${contentId}`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(
      `SURROUND GATE PRECONDITION FAILED: backend unreachable at ${url} (${err.message}). ` +
      `Start this branch's dev server and point TEST_BACKEND_URL/BASE_URL at it.`,
    );
  }
  if (!res.ok) {
    throw new Error(
      `SURROUND GATE PRECONDITION FAILED: GET ${url} returned HTTP ${res.status}. ` +
      `The backend is up but cannot resolve the fixture item.`,
    );
  }
  return res.json();
}

test.beforeAll(async () => {
  // 1. Backend healthy AND able to resolve the enriched fixture.
  enrichedPlay = await getPlay(ENRICHED_ID);
  if (!enrichedPlay?.mediaUrl) {
    throw new Error(
      `SURROUND GATE PRECONDITION FAILED: ${ENRICHED_ID} resolved with no mediaUrl. ` +
      `Got keys: ${Object.keys(enrichedPlay ?? {}).join(', ')}`,
    );
  }

  // 2. The backend actually attaches a surround to it. Without this the whole
  //    suite would be testing an absence and calling it a pass.
  if (!enrichedPlay.surround || typeof enrichedPlay.surround !== 'object') {
    throw new Error(
      `SURROUND GATE PRECONDITION FAILED: GET /api/v1/play/${ENRICHED_ID} carries no \`surround\` field. ` +
      `Either the branch under test does not have the feature, or the sidecar's ` +
      `match.contentId no longer binds (a Plex rescan re-mints ratingKeys). ` +
      `Response keys: ${Object.keys(enrichedPlay).join(', ')}`,
    );
  }

  // 3. The sidecar we wrote the numeric assertions against is the one attached.
  const { piece, movements } = enrichedPlay.surround;
  if (piece?.musicEndsAt !== MUSIC_ENDS_AT) {
    throw new Error(
      `SURROUND GATE PRECONDITION FAILED: sidecar for ${ENRICHED_ID} has ` +
      `musicEndsAt=${piece?.musicEndsAt}, this gate's geometry assumes ${MUSIC_ENDS_AT}. ` +
      `Update the fixture constants together with the sidecar.`,
    );
  }
  const starts = (movements ?? []).map((m) => m.start);
  if (JSON.stringify(starts) !== JSON.stringify(MOVEMENT_STARTS)) {
    throw new Error(
      `SURROUND GATE PRECONDITION FAILED: sidecar movement starts are ` +
      `[${starts}], this gate assumes [${MOVEMENT_STARTS}].`,
    );
  }
  const names = (movements ?? []).map((m) => m.name);
  if (JSON.stringify(names) !== JSON.stringify(MOVEMENT_NAMES)) {
    throw new Error(
      `SURROUND GATE PRECONDITION FAILED: sidecar movement names are ` +
      `[${names}], this gate assumes [${MOVEMENT_NAMES}]. The NOW register's ` +
      `header is asserted against them.`,
    );
  }

  // 4. The negative fixture is genuinely un-enriched. If someone authors a
  //    sidecar for "Summer", the regression case must fail here with a clear
  //    reason rather than fail later as a confusing DOM assertion.
  const plainPlay = await getPlay(PLAIN_ID);
  if (plainPlay?.surround) {
    throw new Error(
      `SURROUND GATE PRECONDITION FAILED: the negative fixture ${PLAIN_ID} now HAS a ` +
      `surround (id=${plainPlay.surround.id}). Pick a different un-enriched item in the ` +
      `same library for the regression case.`,
    );
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Where the MovementMap's playhead sits, as a percentage of the engraved rule.
 *
 * Design wave 5 moved the cursor off `left: N%` and onto a transform, because a
 * painted box's position is pixel-snapped by the engine and a cursor that
 * advances half a pixel a second therefore stood still and then jumped. The
 * component publishes the fraction as `--head` (0..1) and the stylesheet turns
 * it into the translate, so that is what this reads. `style.left` no longer
 * exists on the element — reading it would have returned null and made every
 * assertion below fail for the wrong reason.
 */
async function playheadPct(page) {
  return page.evaluate(() => {
    const head = document.querySelector('[data-testid="surround-playhead"]');
    if (!head) return null;
    const raw = head.style.getPropertyValue('--head');
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n * 100 : null;
  });
}

/** Which movement is sounding at a given transport position, or -1 in the applause. */
function movementAt(position) {
  if (position >= MUSIC_ENDS_AT) return -1;
  for (let i = MOVEMENT_STARTS.length - 1; i >= 0; i -= 1) {
    if (position >= MOVEMENT_STARTS[i]) return i;
  }
  return -1;
}

/** What the playhead SHOULD read for a given playhead position, per MovementMap's geometry. */
function expectedPlayheadPct(position) {
  const first = MOVEMENT_STARTS[0];
  const span = MUSIC_ENDS_AT - first;
  const frac = Math.min(1, Math.max(0, (position - first) / span));
  return frac * 100;
}

/**
 * Seek the real transport and (re)start it. Returns the video's currentTime.
 *
 * Driven through a LOCATOR, not `page.evaluate` + `document.querySelector`: the
 * <video> lives in the <dash-video> shadow root, so a document query in page
 * script returns null and the seek silently becomes a no-op. That is exactly how
 * cases 2 and 3 failed — not because the clock was desynced, but because nobody
 * ever moved it.
 */
async function seekTo(page, seconds) {
  return page.locator(PLAYABLE_SEL).first().evaluate(async (v, t) => {
    v.currentTime = t;
    try { await v.play(); } catch (_) { /* autoplay policy is relaxed by the launch flags */ }
    return v.currentTime;
  }, seconds);
}

async function currentTime(page) {
  return page.locator(PLAYABLE_SEL).first().evaluate((v) => v.currentTime);
}

/**
 * Fix round 1 (review finding M1). `currentTime(page)` and the header's
 * `.textContent()` used to be two independent round trips — each an `await`
 * of its own, with real wall-clock time (and, on a live page, real playback)
 * elapsing between them. A movement boundary landing in that gap made the
 * header check straddle it: `now` read from before the boundary, the header
 * already reading the new movement (or the reverse), and the assertion below
 * would fail for a reason that was never a real defect — a timing race in the
 * GATE, not in the component.
 *
 * `page.evaluate` cannot reach the <video> directly — script in the page does
 * not pierce the <dash-video> shadow root the real element lives in (see
 * `PLAYABLE_SEL`'s own comment) — so this resolves BOTH elements to
 * `ElementHandle`s first (a Playwright locator call, which does pierce it)
 * and then reads `currentTime` and `textContent` off them inside ONE
 * `page.evaluate`, in the same synchronous tick, on the same document frame.
 * Nothing can advance between the two reads.
 */
async function readNowAtBond(page) {
  const [video, bond] = await Promise.all([
    page.locator(PLAYABLE_SEL).first().elementHandle(),
    page.locator('[data-testid="surround-bond"]').first().elementHandle(),
  ]);
  return page.evaluate(([v, b]) => ({
    now: v.currentTime,
    // Where the bond's panel sits on the rule, 0..1 of the rule's own width —
    // read in the SAME evaluate as the clock, so a movement boundary cannot
    // land between the two reads (fix round 1, review finding M1).
    left: parseFloat(b.style.getPropertyValue('--bond-left')) / 100,
    width: parseFloat(b.style.getPropertyValue('--bond-width')) / 100,
    bonded: b.getAttribute('data-bonded'),
  }), [video, bond]);
}

/**
 * Wait until the transport can actually be DRIVEN, not merely until it exists.
 *
 * `waitForSelector(MEDIA_SEL)` resolves the moment the <dash-video> HOST is in
 * the DOM, which is well before dash.js has an initialised stream behind it. A
 * `currentTime` written into that gap is silently discarded — readyState is 0
 * and duration NaN — and playback then starts from its own resume point, tens of
 * seconds away from where the test asked it to go. That is exactly how case 2
 * read "the playhead never moved to the sought position": the clock was fine,
 * nothing had moved it.
 */
async function waitForTransport(page) {
  const video = page.locator(PLAYABLE_SEL).first();
  await expect
    .poll(async () => video.evaluate((v) => v.readyState >= 3 && v.duration > 0), {
      timeout: 60000,
      message: 'the transport never became seekable — dash.js has no initialised stream',
    })
    .toBe(true);

  // ...and it is RUNNING. A stalled element accepts a seek and then sits there,
  // which would make case 3's "the playhead passed the dwell" unprovable.
  const started = await video.evaluate((v) => v.currentTime);
  await expect
    .poll(async () => video.evaluate((v) => v.currentTime), {
      timeout: 30000,
      message: 'the transport loaded but never advanced — playback is not running',
    })
    .toBeGreaterThan(started);
}

/** Load an item through the URL-autoplay seam and wait for the media element. */
async function openViaUrl(page, contentId) {
  await page.goto(`${FRONTEND_URL}/tv?play=${encodeURIComponent(contentId)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  await page.waitForSelector(MEDIA_SEL, { timeout: 60000 });
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

test.describe('Surround — PoC runtime gate', () => {
  test.use({ viewport: HD });

  test('1. URL autoplay mounts the frame and locks the video to 16:9', async ({ page }) => {
    await openViaUrl(page, ENRICHED_ID);

    const frame = page.locator('[data-testid="surround-frame"]');
    await expect(frame).toHaveCount(1, { timeout: 20000 });

    // The programme panels the definition declares (concert-hall).
    await expect(page.locator('.surround-frame__region[data-module="movement-map"]')).toHaveCount(1);
    await expect(page.locator('.surround-frame__region[data-module="cue-ticker"]')).toHaveCount(1);
    await expect(page.locator('.surround-frame__region[data-module="composer-card"]')).toHaveCount(1);

    // The video must be INSIDE the aspect-locked box, not merely on the page.
    const media = page.locator('[data-testid="surround-media"]');
    await expect(media).toHaveCount(1);
    // Exactly ONE playable element, and it is inside the aspect-locked box.
    // (`MEDIA_SEL` would read 2 here — the <dash-video> host plus the <video>
    // in its shadow root — which says nothing about how many videos are playing.)
    await expect(media.locator(PLAYABLE_SEL)).toHaveCount(1);

    // The quality floor of the whole feature: 16:9 ±1% on the media box.
    const box = await media.boundingBox();
    expect(box, 'surround-media has no layout box').not.toBeNull();
    expect(box.width, 'surround-media has zero width').toBeGreaterThan(0);
    expect(box.height, 'surround-media has zero height').toBeGreaterThan(0);
    const ratio = box.width / box.height;
    const target = 16 / 9;
    expect(
      Math.abs(ratio - target) / target,
      `surround-media is ${box.width}x${box.height} (ratio ${ratio.toFixed(4)}), expected ${target.toFixed(4)}`,
    ).toBeLessThanOrEqual(0.01);
  });

  test('2. seeking the transport moves the MovementMap cursor with the playhead', async ({ page }) => {
    await openViaUrl(page, ENRICHED_ID);
    await waitForTransport(page);
    await page.waitForSelector('[data-testid="surround-playhead"]', { timeout: 20000 });

    // Somewhere in movement II (225–385) — far from both ends of the rule, so a
    // cursor stuck at 0 or pinned at 100% cannot accidentally satisfy this.
    const TARGET = 300;
    // Inside movement I, far below TARGET.
    const ORIGIN = 30;

    // PARK THE TRANSPORT FIRST. Playback RESUMES where it last stopped, and this
    // gate is what last stopped it — after one run the fixture's saved position
    // can already be past TARGET, and "the cursor moved forward" then reads
    // false for a reason that has nothing to do with the map. Seeking to a known
    // origin makes `before` ours instead of a leftover, so the forward-motion
    // assertion below can stay exactly as strong as it was written.
    await seekTo(page, ORIGIN);
    await expect
      .poll(async () => playheadPct(page), {
        timeout: 20000,
        message: 'the transport never parked at the origin — it is not accepting seeks at all',
      })
      .toBeLessThan(expectedPlayheadPct(ORIGIN) + 3);

    const before = await playheadPct(page);
    expect(before, 'playhead publishes no position before the seek').not.toBeNull();

    await seekTo(page, TARGET);

    // The clock samples at 10 Hz; poll rather than assume the next paint.
    await expect
      .poll(async () => playheadPct(page), {
        timeout: 20000,
        message: 'playhead never moved to the sought position',
      })
      .toBeGreaterThan(expectedPlayheadPct(TARGET) - 3);

    const after = await playheadPct(page);
    const actualTime = await currentTime(page);
    expect(actualTime, 'the transport did not accept the seek').toBeGreaterThan(TARGET - 10);

    // Consistent with the REAL currentTime, not merely with what we asked for.
    const expectedNow = expectedPlayheadPct(actualTime);
    expect(
      Math.abs(after - expectedNow),
      `playhead reads ${after}% but currentTime ${actualTime}s implies ${expectedNow}%`,
    ).toBeLessThanOrEqual(3);
    expect(after, 'playhead did not move at all').toBeGreaterThan(before + 5);

    // And the map agrees about WHICH movement is sounding.
    await expect(
      page.locator('[data-testid="surround-movement"][data-index="1"]'),
      'movement II should be the active segment at 300s',
    ).toHaveAttribute('data-state', 'active', { timeout: 10000 });
  });

  test('3. the cue ticker advances off the opening cue as the playhead passes its dwell', async ({ page }) => {
    await openViaUrl(page, ENRICHED_ID);
    await waitForTransport(page);
    await page.waitForSelector('[data-testid="surround-ticker-listen"]', { timeout: 20000 });

    const ticker = page.locator('[data-testid="surround-cue-ticker"]');
    // DESIGN WAVE 6: a timed cue belongs to the NOW register on the right. It
    // is a claim about what is sounding right now, which is that zone's whole
    // subject; the piece register on the left goes on with the programme note
    // and is deliberately NOT what this case reads. Reading the left zone here
    // would have made the case pass on a rotation it has nothing to do with.
    const text = page.locator('[data-testid="surround-ticker-listen"]');

    // Land inside the opening cue's dwell window [0, 12).
    const INSIDE_CUE = FIRST_CUE_AT + 6;
    await seekTo(page, INSIDE_CUE);

    await expect(ticker, 'the opening cue should own the panel inside its dwell window')
      .toHaveAttribute('data-kind', 'cue', { timeout: 20000 });
    await expect(text).toContainText(FIRST_CUE_SNIPPET, { timeout: 10000 });
    const cueText = (await text.textContent())?.trim();

    // Now let the real transport run past the dwell. No fake timers: the point of
    // this case is that the panel is driven by the playhead, not by a React timer.
    await expect
      .poll(async () => currentTime(page), {
        timeout: 45000,
        message: 'playback never advanced past the opening cue window — the transport is not running',
      })
      .toBeGreaterThan(FIRST_CUE_AT + CUE_DWELL_S + 1);

    // Past the dwell the cue yields the register back to the movement's own
    // listening notes.
    await expect
      .poll(async () => (await text.textContent())?.trim(), {
        timeout: 15000,
        message: 'the NOW register still shows the opening cue after its dwell window closed',
      })
      .not.toBe(cueText);
    await expect(ticker).not.toHaveAttribute('data-kind', 'cue');
  });

  test('4. an un-enriched item gets NO frame and NO wrapper element', async ({ page }) => {
    await openViaUrl(page, PLAIN_ID);

    await expect(page.locator('[data-testid="surround-frame"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="surround-media"]')).toHaveCount(0);

    // The contract is stronger than "no frame": SurroundHost must render its
    // children DIRECTLY, so the player's DOM is identical to mounting it alone.
    // Any surround-owned element anywhere above the media is a contract break.
    const surroundAncestors = await page.evaluate(() => {
      const media = document.querySelector('video, dash-video');
      if (!media) return null;
      const offenders = [];
      for (let el = media.parentElement; el; el = el.parentElement) {
        const cls = typeof el.className === 'string' ? el.className : '';
        const testid = el.getAttribute?.('data-testid') ?? '';
        if (/(^|\s)surround-/.test(cls) || /^surround-/.test(testid)) {
          offenders.push(testid || cls);
        }
      }
      return offenders;
    });
    expect(surroundAncestors, 'no media element found on the page').not.toBeNull();
    expect(
      surroundAncestors,
      `SurroundHost introduced wrapper element(s) around an un-enriched item: ${surroundAncestors?.join(', ')}`,
    ).toEqual([]);
  });

  test('5. menu-selected playback gets the same frame (the second seam)', async ({ page }) => {
    // This is the case the original design would have failed: it wrapped
    // ScreenPlayer only, so every menu selection played unframed.
    await page.goto(`${FRONTEND_URL}/tv?list=${encodeURIComponent(SHOW_ID)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    // SCOPE EVERY SELECTOR TO THE OVERLAY. The screen's own full-screen menu
    // WIDGET and the MenuStack overlay share one MenuNavigationContext, so a
    // push in the overlay drives the widget's stack to the same level too: the
    // season grid exists TWICE in the page, at identical coordinates, and an
    // unscoped `.first()` resolves to the widget's copy — which the overlay then
    // covers, so the click never lands. The overlay is also the only copy this
    // case is about: MenuStack IS the second seam.
    const overlay = page.locator('.screen-overlay--fullscreen');

    // MenuStack's root is the SHOW's menu: its seasons. Selecting one carries
    // `type: 'season'`, which is what pushes the episode grid.
    const season = overlay.locator('.menu-item').filter({ hasText: 'Season 1' }).first();
    await expect(season, 'the show menu never rendered').toBeVisible({ timeout: 45000 });
    await season.click();

    const cards = overlay.locator('.episode-grid-card');
    await expect(cards.first(), 'the season menu never rendered').toBeVisible({ timeout: 45000 });

    const spring = cards.filter({ hasText: 'Spring' }).first();
    await expect(spring, 'the enriched episode is not in this menu').toBeVisible({ timeout: 15000 });
    // Click the TITLE, not the card's centre: the card's own one-line
    // description covers that centre, and Playwright refuses a click whose
    // target is not the element that would receive it. The handler is on the
    // card, so a click on any child still selects the episode.
    await spring.locator('.episode-grid-card__title').click();

    // MenuStack mounts the player through a lazy chunk, and SurroundHost reads
    // the imperative handle on a 1 Hz poll — so the frame is at most one poll
    // behind the player appearing.
    await page.waitForSelector(MEDIA_SEL, { timeout: 60000 });
    await page.waitForTimeout(1500);

    // Still scoped to the overlay, and for the same reason: the shared nav stack
    // means the screen's menu widget mounts its OWN player alongside this one, so
    // the page carries two frames. Counting them page-wide would assert the
    // framework's duplication rather than this seam's contract; counting inside
    // the overlay asserts exactly what case 5 exists to prove — the player
    // MenuStack mounted is wrapped, exactly once.
    const frame = overlay.locator('[data-testid="surround-frame"]');
    await expect(
      frame,
      'menu-selected playback rendered unframed — the MenuStack seam is not wrapped',
    ).toHaveCount(1, { timeout: 20000 });

    // Same contract as the URL path, asserted the same way.
    const media = overlay.locator('[data-testid="surround-media"]');
    await expect(media.locator(PLAYABLE_SEL)).toHaveCount(1);
    const box = await media.boundingBox();
    expect(box).not.toBeNull();
    const ratio = box.width / box.height;
    const target = 16 / 9;
    expect(
      Math.abs(ratio - target) / target,
      `menu-path surround-media is ${box.width}x${box.height} (ratio ${ratio.toFixed(4)})`,
    ).toBeLessThanOrEqual(0.01);
  });
});

// ---------------------------------------------------------------------------
// The composed-layout gate — the recomposition as it stands after design wave 4:
// the work's title LEADS (the plate is the headline of the screen) and the
// movement band's RULE ROW rides at the top of the band, against the video's
// bottom edge, with the names below it. Everything wave 3 pinned still holds:
// the placard FLOATS, straddling the video's top edge as a content-width museum
// plate; the dark band sits flush under the video and slightly over it; the rail
// is LEFT at 33% width via `regions.right[0].side: 'left'`, and inside it the
// composer card's header row runs PORTRAIT | NAMEPLATE side by side above a
// place carousel. Nothing here can be seen by the jsdom unit suites; this is the
// only gate that pins real, measured geometry.
// ---------------------------------------------------------------------------

test.describe('Surround — composed layout gate', () => {
  test.use({ viewport: HD });

  test('the composed layout: the plate straddles, the band overlaps, nothing clips, rail is on the left', async ({ page }) => {
    await openViaUrl(page, ENRICHED_ID);
    await page.waitForSelector('[data-testid="surround-frame"]', { timeout: 20000 });
    // THE ENRICHMENT MOMENT has to be over before any geometry is read.
    // Design wave 5 added the biggest move of all — the VIDEO shrinks from the
    // whole frame into its box — so the settle wait now has to outlast
    // `ENTER_UNCLIP_MS` (the stage's clip coming back, ~740ms), not just the
    // chrome's transitions. Measured mid-flight, the media box is a transformed
    // box and the plate is 12px high of where it lands: every assertion below
    // would be reading the animation instead of the design.
    await page.waitForTimeout(1500);

    const box = async (sel) => {
      const b = await page.locator(sel).first().boundingBox();
      expect(b, `${sel} has no box`).not.toBeNull();
      return b;
    };
    // THE FRAME IS THE MEASURING STICK, NOT THE BROWSER WINDOW. A screen route
    // renders into a fixed-resolution `screen-root` (the living-room screen is a
    // 960x540 CSS viewport at 2x DPR) letterboxed inside whatever window it is
    // given, so the frame here is 960x540 in a 1920x1080 page. "A third of the
    // rail" and "not clipped off-screen" are claims about THAT box: measured
    // against the window they are both weaker than intended — a third of the
    // frame reads as a sixth, and everything trivially clears a bottom edge
    // 270px below the frame's own.
    const frame = await box('.surround-frame');
    const bottomEdge = frame.y + frame.height;

    // 1. The placard is mounted and STRADDLES the video's top edge — part on the
    //    dark hall above, part over the picture, like a plate pinned to a
    //    painting. (Was: a full-width band sitting entirely above the video.)
    const placard = await box('.surround-frame__header');
    const media = await box('.surround-frame__media');
    //    The 16:9 lock is inviolable — none of the recomposition (top-anchored
    //    stage, straddling plate, overlapping band) may distort the media box.
    expect(
      Math.abs(media.width / media.height - 16 / 9),
      `media box is ${media.width}x${media.height} — not locked to 16:9`,
    ).toBeLessThan(0.02);
    expect(
      placard.y + placard.height,
      'the plate does not reach the video — it is a band again, not a plate',
    ).toBeGreaterThan(media.y);
    expect(
      placard.y,
      'the plate starts below the video top — it is not straddling the edge',
    ).toBeLessThan(media.y);

    //    ...and it straddles by the RIGHT amount (design wave 5). Half and half
    //    cut too deep into the picture; the plate now hangs two thirds on the
    //    hall and a third on the video. The window is deliberately wider than
    //    the design's own number so a later tune is free, and deliberately
    //    narrower than "any overlap at all" so it can actually fail: wave 4's
    //    50% and a 5%-graze both fall outside it.
    const overlapDepth = (placard.y + placard.height - media.y) / placard.height;
    expect(
      overlapDepth,
      `the plate cuts ${(overlapDepth * 100).toFixed(0)}% of its height into the video`,
    ).toBeLessThan(0.45);
    expect(
      overlapDepth,
      `the plate overlaps the video by only ${(overlapDepth * 100).toFixed(0)}% — it grazes the edge`,
    ).toBeGreaterThan(0.20);

    //    Content-width: a plate is narrower than the painting it is pinned to.
    expect(
      placard.width,
      `plate is ${placard.width}px against a ${media.width}px video — it is still a band`,
    ).toBeLessThan(media.width);

    //    ...and centred on the video's axis.
    const placardCentre = placard.x + placard.width / 2;
    const mediaCentre = media.x + media.width / 2;
    expect(
      Math.abs(placardCentre - mediaCentre),
      `plate centre ${placardCentre} vs video centre ${mediaCentre}`,
    ).toBeLessThanOrEqual(8);

    // 1b. THE TITLE LEADS (design wave 4). The plate is the headline of the
    //     whole screen: walking into the room, the WORK must be the first thing
    //     legible. The floor is on the rendered pixel size, which is the only
    //     place a font-size regression, a cascade override and a shrunk root
    //     size all show up together — a unit test on the stylesheet catches
    //     only the first of the three.
    const titleFs = await page.locator('.surround-work-placard__title').first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(
      titleFs,
      `work title renders at ${titleFs}px — too quiet to lead the screen`,
    ).toBeGreaterThanOrEqual(30);
    const metaFs = await page.locator('.surround-work-placard__meta').first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(
      titleFs / metaFs,
      `title ${titleFs}px vs meta ${metaFs}px — the provenance line competes with the work`,
    ).toBeGreaterThan(2);

    // 2. The band does not merely touch the video, it OVERLAPS it: its top edge
    //    rides over the video's last few pixels, with the join softened by a
    //    gradient. The overlap is bounded so it can never eat the picture.
    const footer = await box('.surround-frame__footer');
    const mediaBottom = media.y + media.height;
    expect(
      footer.y,
      `band starts ${footer.y - mediaBottom}px BELOW the video — the gap is back`,
    ).toBeLessThanOrEqual(mediaBottom);
    expect(
      footer.y,
      `band overlaps the video by ${mediaBottom - footer.y}px — too much of the picture`,
    ).toBeGreaterThanOrEqual(mediaBottom - 16);

    // 3. The playhead never enters the text band. The law is unchanged from
    //    design wave 2; its DIRECTION is inverted by wave 4. The rule row now
    //    rides at the TOP of the band and the movement names hang BELOW it, so
    //    the clearance reads "playhead lane ends before the heading begins"
    //    rather than the other way round. Movement names may wrap to two lines,
    //    so this still reads the heading's REAL box rather than assuming one.
    const heading = await box('.surround-movement-map__heading');
    const playhead = await box('.surround-movement-map__playhead');
    expect(
      playhead.y + playhead.height,
      `playhead ends at ${playhead.y + playhead.height}, inside the heading box `
      + `(starts ${heading.y}) — the rule lane and the names have collided`,
    ).toBeLessThanOrEqual(heading.y + 1);

    // 3b. ...and the rule row is where wave 4 put it: hard against the video's
    //     bottom edge, inside the band's own upward overlap — NOT floating in a
    //     strip of black below it, which is the gap the user saw. The window is
    //     the same one the footer's overlap is bounded by in 2 above.
    expect(
      playhead.y,
      `the rule row starts ${playhead.y - mediaBottom}px below the video — the gap is back`,
    ).toBeLessThanOrEqual(mediaBottom + 2);
    expect(
      playhead.y,
      `the rule row rides ${mediaBottom - playhead.y}px up over the picture — too much`,
    ).toBeGreaterThanOrEqual(mediaBottom - 16);

    // 3c. THE TWO MOVING MARKS GLIDE (design wave 5). Both the cursor and the
    //     elapsed fill move on a TRANSFORM, because Chromium pixel-snaps a
    //     painted box's position and size — a cursor advancing half a pixel per
    //     second on `left` stands still and then jumps, which is the "creeps one
    //     pixel at a time" of the review. The unit suite pins this on the
    //     compiled stylesheet; here it is read off the RENDERED element, which is
    //     the only place a cascade override or a lost build step shows up.
    for (const [name, sel] of [
      ['playhead', '.surround-movement-map__playhead'],
      ['fill', '[data-testid="surround-movement-fill"]'],
    ]) {
      const ramp = await page.locator(sel).first().evaluate((el) => {
        const cs = getComputedStyle(el);
        return { prop: cs.transitionProperty, dur: cs.transitionDuration, timing: cs.transitionTimingFunction, transform: cs.transform };
      });
      expect(ramp.prop, `the ${name} animates ${ramp.prop}, a property the engine snaps`).toBe('transform');
      expect(parseFloat(ramp.dur), `the ${name} has no glide`).toBeGreaterThan(0);
      expect(ramp.timing).toBe('linear');
      expect(ramp.transform, `the ${name} carries no transform to glide on`).not.toBe('none');
    }

    //    ...and the lit tip is gone for good: progress is read from the fill.
    expect(
      await page.locator('.surround-movement-map__playhead-edge').count(),
      'the glowing playhead tip is back',
    ).toBe(0);
    expect(
      await page.locator('[data-testid="surround-movement-fill"]').count(),
      'no elapsed fill on the band — progress has nothing to be read from',
    ).toBeGreaterThanOrEqual(1);

    // 3d. THE BAND SPLITS (design wave 6). Under the rule the text zone is two
    //     registers: the PIECE on the left (untimed programme notes) and NOW on
    //     the right (a header naming the movement that is sounding, then that
    //     movement's listening notes). Both have to be present and neither may
    //     be a sliver — a `flex: 1 1 50%` that lost its `min-width: 0` collapses
    //     one of them, which no jsdom spec can see.
    for (const sel of [
      '[data-testid="surround-ticker-zone-piece"]',
      '[data-testid="surround-ticker-zone-now"]',
    ]) {
      const count = await page.locator(sel).count();
      expect(count, `${sel} did not render — the band is not split`).toBe(1);
    }
    const zonePiece = await box('[data-testid="surround-ticker-zone-piece"]');
    const zoneNow = await box('[data-testid="surround-ticker-zone-now"]');
    expect(
      Math.abs(zonePiece.width - zoneNow.width),
      `the two registers are ${zonePiece.width}px and ${zoneNow.width}px — not halves`,
    ).toBeLessThanOrEqual(2);
    expect(zoneNow.x, 'the NOW register is not to the right of the piece register')
      .toBeGreaterThan(zonePiece.x);
    //     ...and neither register overflows the band it was given. This is the
    //     one thing the design wave had to measure rather than declare: the
    //     movement names' translation line takes ~17px off this zone, and on
    //     the 960x540 screen-root the ticker is left with about forty.
    const tickerFit = await page.locator('[data-testid="surround-cue-ticker"]').first()
      .evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(
      tickerFit.scroll,
      `the band's text zone overflows itself by ${tickerFit.scroll - tickerFit.client}px`,
    ).toBeLessThanOrEqual(tickerFit.client + 1);

    //     3e. THE BOND NAMES WHAT IS SOUNDING (design wave 7). The NOW
    //     register no longer prints the movement heading the rail above it has
    //     already set — the user's word for that repetition was "wasteful".
    //     What says WHICH movement this register belongs to is the BOND: the
    //     sounding segment's panel and this register's panel drawn in one
    //     ground and joined along the band's seam.
    //
    //     So this is still a real cross-check between the video's clock and
    //     the band's answer — it just reads a geometry rather than a string,
    //     and the geometry is the harder thing to get right. Both reads happen
    //     inside ONE `page.evaluate` (fix round 1, review finding M1) so a
    //     movement boundary cannot land between them.
    expect(
      await page.locator('[data-testid="surround-ticker-now"]').count(),
      'the NOW register is reprinting the movement heading the rail already set',
    ).toBe(0);

    const { now, left, width, bonded } = await readNowAtBond(page);
    const index = movementAt(now);
    expect(
      index,
      `the transport is at ${now}s, which is not inside any movement — reseek the fixture`,
    ).toBeGreaterThanOrEqual(0);
    expect(bonded, `nothing is bonded at ${now.toFixed(1)}s, inside movement ${index + 1}`)
      .toBe('true');
    //     The panel covers the segment the clock says is sounding — asserted
    //     against that segment's OWN rendered box, because the accordion means
    //     a segment's width is no longer its duration's share of the rule.
    const seg = await box(`[data-testid="surround-movement"][data-index="${index}"]`);
    const rule = await box('.surround-movement-map__rule');
    expect(
      Math.abs((rule.x + left * rule.width) - seg.x),
      `the bond starts at ${(rule.x + left * rule.width).toFixed(1)} but movement `
      + `${index + 1} ("${MOVEMENT_NAMES[index]}") starts at ${seg.x.toFixed(1)}`,
    ).toBeLessThanOrEqual(1.5);
    expect(
      Math.abs(width * rule.width - seg.width),
      `the bond is ${(width * rule.width).toFixed(1)}px wide over a ${seg.width.toFixed(1)}px segment`,
    ).toBeLessThanOrEqual(1.5);

    //     ...and the two halves of the shape are actually CONTIGUOUS on screen.
    //     This is the one claim no jsdom spec can make: the rail's panel (or
    //     its connector, where the segment is on the far side of the band) has
    //     to meet the register's panel at the region seam with nothing between
    //     them, horizontally and vertically.
    const bondBox = await box('[data-testid="surround-bond"]');
    const connBox = await box('[data-testid="surround-bond-connector"]');
    const groundBox = await box('[data-testid="surround-ticker-ground"]');
    expect(
      Math.abs((bondBox.y + bondBox.height) - groundBox.y),
      `the rail's panel ends at ${(bondBox.y + bondBox.height).toFixed(1)} and the `
      + `register's begins at ${groundBox.y.toFixed(1)} — the bond has a seam`,
    ).toBeLessThanOrEqual(1);
    // Horizontal continuity: panel ∪ connector must reach the register's panel.
    const spanLeft = Math.min(bondBox.x, connBox.width > 0 ? connBox.x : bondBox.x);
    const spanRight = Math.max(
      bondBox.x + bondBox.width,
      connBox.width > 0 ? connBox.x + connBox.width : bondBox.x + bondBox.width,
    );
    const gap = Math.max(0, Math.max(spanLeft, groundBox.x)
      - Math.min(spanRight, groundBox.x + groundBox.width));
    expect(
      gap,
      `${gap.toFixed(1)}px of band ground between the rail's panel and the register's `
      + '— the bond reads as two marks, not one shape',
    ).toBeLessThanOrEqual(1);
    //     ...and they are the SAME ground, which is what makes them one shape
    //     rather than two panels that happen to touch.
    const grounds = await page.evaluate(() => [
      getComputedStyle(document.querySelector('[data-testid="surround-bond"]')).backgroundColor,
      getComputedStyle(document.querySelector('[data-testid="surround-ticker-ground"]')).backgroundColor,
    ]);
    expect(grounds[0], `the two panels are painted ${grounds[0]} and ${grounds[1]}`)
      .toBe(grounds[1]);

    //     3f. THE NUMERAL'S GUTTER (design wave 7). Every segment's heading and
    //     every segment's gloss start on the SAME text edge, measured from the
    //     segment's own left — which is what the fixed-width numeral track
    //     exists to guarantee and what the old inline numeral broke.
    const edges = await page.evaluate(() => [...document.querySelectorAll(
      '.surround-movement-map__segment',
    )].map((segment) => {
      const l = segment.getBoundingClientRect().left;
      const heading = segment.querySelector('.surround-movement-map__heading');
      const gloss = segment.querySelector('.surround-movement-map__translation');
      return {
        heading: +(heading.getBoundingClientRect().left - l).toFixed(2),
        gloss: gloss ? +(gloss.getBoundingClientRect().left - l).toFixed(2) : null,
      };
    }));
    expect(edges.length, 'no segments on the rail').toBeGreaterThan(0);
    const textEdge = edges[0].heading;
    for (const [i, e] of edges.entries()) {
      expect(
        Math.abs(e.heading - textEdge),
        `movement ${i + 1}'s name starts at ${e.heading} against ${textEdge} on the first`,
      ).toBeLessThanOrEqual(0.5);
      if (e.gloss !== null) {
        expect(
          Math.abs(e.gloss - e.heading),
          `movement ${i + 1}'s gloss starts at ${e.gloss}, its name at ${e.heading} `
          + '— the translation is rendering under the numeral',
        ).toBeLessThanOrEqual(0.5);
      }
    }

    // 4. Every rail child ends on-screen (the bio used to end at 742 of 720).
    //    The nameplate and the place-carousel are NOT optional for this fixture:
    //    the nameplate always renders in a composer-card rail, and the carousel
    //    is authored in the enriched fixture's live definition (design wave 3
    //    replaced the standalone `country-map` region with it — the map is one
    //    of the carousel's slides now). For both, count===0 is a mount failure,
    //    not an absent-content case, so it must fail loudly rather than be
    //    skipped.
    for (const sel of [
      '.surround-composer-card__nameplate',
      '.surround-frame__region[data-module="place-carousel"]',
    ]) {
      const count = await page.locator(sel).count();
      expect(count, `${sel} did not mount`).toBeGreaterThanOrEqual(1);
      const b = await box(sel);
      expect(b.y + b.height, `${sel} clipped below the frame`).toBeLessThanOrEqual(bottomEdge + 1);
    }

    // 4b. THE HEADER ROW (design wave 3). The portrait and the nameplate are
    //     SIDE BY SIDE, not stacked: the picture's right edge does not pass the
    //     nameplate's left edge. This is the one thing about the new anatomy no
    //     jsdom test can see — the components render the same DOM whether the
    //     row lays out as a row or wraps into a column.
    //     `.surround-composer-card__plate` is NOT optional here either: the
    //     enriched fixture always authors a portrait, so `box()` failing to find
    //     it is a mount failure, not an absent-content case — same convention as
    //     the nameplate/carousel check in 4 above.
    // The mat is `fit-content` around `img { width: 100% }`, so before the
    // portrait finishes decoding its box is ~0-wide and the side-by-side
    // assertion below (`portrait right edge <= nameplate left + 2`) passes
    // for free against a sliver — not because the layout is actually a row.
    // Wait for the real decode before trusting any geometry off this element.
    await page.waitForFunction(() => {
      const img = document.querySelector('.surround-composer-card__portrait');
      return !!img && img.complete && img.naturalWidth > 0;
    }, { timeout: 10000 });

    const rail = await box('.surround-frame__rail');
    const portraitBox = await box('.surround-composer-card__plate');
    const nameplateBox = await box('.surround-composer-card__nameplate');
    //     A floor on the portrait's width: without this, a regression back to
    //     an undecoded/collapsed mat would still satisfy the side-by-side
    //     check above (a ~0-wide box is trivially left of the nameplate).
    expect(
      portraitBox.width,
      `portrait is only ${portraitBox.width}px wide against a ${rail.width}px rail — `
      + `looks collapsed/undecoded, not a real picture`,
    ).toBeGreaterThan(rail.width * 0.2);
    expect(
      portraitBox.x + portraitBox.width,
      `portrait ends at ${portraitBox.x + portraitBox.width} but the nameplate starts at `
      + `${nameplateBox.x} — the header row is stacked, not side by side`,
    ).toBeLessThanOrEqual(nameplateBox.x + 2);
    //     ...and both are inside the rail, not spilling into the picture.
    for (const [name, b] of [['portrait', portraitBox], ['nameplate', nameplateBox]]) {
      expect(b.x, `${name} starts left of the rail`).toBeGreaterThanOrEqual(rail.x - 1);
      expect(
        b.x + b.width,
        `${name} ends at ${b.x + b.width}, past the rail's right edge ${rail.x + rail.width}`,
      ).toBeLessThanOrEqual(rail.x + rail.width + 1);
    }

    // The fact is the ONE genuinely optional child: a composer without an
    // authored fact renders no fact element at all, so skip only when absent.
    const factCount = await page.locator('.surround-composer-card__fact').count();
    if (factCount > 0) {
      const factBox = await box('.surround-composer-card__fact');
      expect(factBox.y + factBox.height, 'fact clipped below the frame').toBeLessThanOrEqual(bottomEdge + 1);
    }

    // 5. The rail is on the LEFT, not the right — the recomposed contract.
    // `regions.right[0].side: 'left'` moves it; the region KEY stays `right`.
    // (`rail` was read above, for the header-row containment check.)
    expect(rail.x + rail.width, 'rail is not entirely left of the video').toBeLessThanOrEqual(media.x + 2);
    expect(rail.width / frame.width, 'rail is a fifth, not a third').toBeGreaterThan(0.30);

    // 6. Fix round 1 (review finding, CRITICAL, user-reported). Pausing the
    //    video brings up the Player's own `.loading-overlay` — before the fix,
    //    nothing between it and the page root created a stacking context, so it
    //    escaped `.surround-frame__media` and painted over the placard's lower
    //    third. `isolation: isolate` on the media box is what seals it in.
    //    Pause through the same LOCATOR the seek helpers use (see `seekTo`
    //    above) — the <video> lives inside the <dash-video> shadow root, so a
    //    document query from page script would silently no-op.
    await page.locator(PLAYABLE_SEL).first().evaluate((v) => v.pause());
    await page.waitForTimeout(600);

    const mediaIsolation = await page.locator('.surround-frame__media').first()
      .evaluate((el) => getComputedStyle(el).isolation);
    expect(
      mediaIsolation,
      'the media box does not seal its own stacking context — a paused/loading overlay can escape it',
    ).toBe('isolate');

    // ...and the straddle from part 1 still holds while paused: sealing the
    // media box must not have moved the plate or the video it sits on.
    const placardPaused = await box('.surround-frame__header');
    const mediaPaused = await box('.surround-frame__media');
    expect(
      placardPaused.y + placardPaused.height,
      'the plate no longer reaches the video once paused',
    ).toBeGreaterThan(mediaPaused.y);
    expect(
      placardPaused.y,
      'the plate starts below the video top once paused — it is not straddling the edge',
    ).toBeLessThan(mediaPaused.y);
    const overlapDepthPaused = (placardPaused.y + placardPaused.height - mediaPaused.y) / placardPaused.height;
    expect(overlapDepthPaused, 'the straddle window shifted once paused').toBeLessThan(0.45);
    expect(overlapDepthPaused, 'the straddle window shifted once paused').toBeGreaterThan(0.20);
  });
});
