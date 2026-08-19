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
/** The season the enriched item lives in — the menu the second seam is driven through. */
const SEASON_ID = 'plex:663145';
/** Vivaldi, "Summer" (S01E02). Same show, same library, deliberately NOT authored. */
const PLAIN_ID = 'plex:663147';

/** From the sidecar's `piece.musicEndsAt` — the MovementMap's rule ends here, not at `duration`. */
const MUSIC_ENDS_AT = 613;
/** From the sidecar's `movements[].start`. */
const MOVEMENT_STARTS = [0, 225, 385];
/** The sidecar's first cue is at 0s with the default 12s dwell. */
const FIRST_CUE_AT = 0;
const CUE_DWELL_S = 12;
const FIRST_CUE_SNIPPET = 'Spring has arrived';

const HD = { width: 1920, height: 1080 };
/** dash_video is the format for these items; accept a bare <video> too. */
const MEDIA_SEL = 'video, dash-video';

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

/** Where the MovementMap's playhead sits, as a percentage of the engraved rule. */
async function playheadPct(page) {
  return page.evaluate(() => {
    const head = document.querySelector('[data-testid="surround-playhead"]');
    if (!head) return null;
    const left = head.style.left || '';
    const m = left.match(/^([\d.]+)%$/);
    return m ? parseFloat(m[1]) : null;
  });
}

/** What the playhead SHOULD read for a given playhead position, per MovementMap's geometry. */
function expectedPlayheadPct(position) {
  const first = MOVEMENT_STARTS[0];
  const span = MUSIC_ENDS_AT - first;
  const frac = Math.min(1, Math.max(0, (position - first) / span));
  return frac * 100;
}

/** Seek the real transport and (re)start it. Returns the video's currentTime afterwards. */
async function seekTo(page, seconds) {
  return page.evaluate(async (t) => {
    const v = document.querySelector('video');
    if (!v) return null;
    v.currentTime = t;
    try { await v.play(); } catch (_) { /* autoplay policy is relaxed by the launch flags */ }
    return v.currentTime;
  }, seconds);
}

async function currentTime(page) {
  return page.evaluate(() => document.querySelector('video')?.currentTime ?? null);
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
    await expect(media.locator(MEDIA_SEL)).toHaveCount(1);

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
    await page.waitForSelector('[data-testid="surround-playhead"]', { timeout: 20000 });

    // Somewhere in movement II (225–385) — far from both ends of the rule, so a
    // cursor stuck at 0 or pinned at 100% cannot accidentally satisfy this.
    const TARGET = 300;
    const before = await playheadPct(page);
    expect(before, 'playhead has no left offset before the seek').not.toBeNull();

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
    await page.waitForSelector('[data-testid="surround-ticker-text"]', { timeout: 20000 });

    const ticker = page.locator('[data-testid="surround-cue-ticker"]');
    const text = page.locator('[data-testid="surround-ticker-text"]');

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

    // Past the dwell the cue yields the panel back to the fact rotation.
    await expect
      .poll(async () => (await text.textContent())?.trim(), {
        timeout: 15000,
        message: 'the ticker still shows the opening cue after its dwell window closed',
      })
      .not.toBe(cueText);
    await expect(ticker).toHaveAttribute('data-kind', 'fact');
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
    await page.goto(`${FRONTEND_URL}/tv?list=${encodeURIComponent(SEASON_ID)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    const cards = page.locator('.episode-grid-card');
    await expect(cards.first(), 'the season menu never rendered').toBeVisible({ timeout: 45000 });

    const spring = cards.filter({ hasText: 'Spring' }).first();
    await expect(spring, 'the enriched episode is not in this menu').toBeVisible({ timeout: 15000 });
    await spring.click();

    // MenuStack mounts the player through a lazy chunk, and SurroundHost reads
    // the imperative handle on a 1 Hz poll — so the frame is at most one poll
    // behind the player appearing.
    await page.waitForSelector(MEDIA_SEL, { timeout: 60000 });
    await page.waitForTimeout(1500);

    const frame = page.locator('[data-testid="surround-frame"]');
    await expect(
      frame,
      'menu-selected playback rendered unframed — the MenuStack seam is not wrapped',
    ).toHaveCount(1, { timeout: 20000 });

    // Same contract as the URL path, asserted the same way.
    const media = page.locator('[data-testid="surround-media"]');
    await expect(media.locator(MEDIA_SEL)).toHaveCount(1);
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
// The composed-layout gate — the recomposition as it stands after design wave 2:
// the placard FLOATS, straddling the video's top edge as a content-width museum
// plate; the dark band sits flush under the video and slightly over it; the rail
// is LEFT at 33% width via `regions.right[0].side: 'left'`. Nothing here can be
// seen by the jsdom unit suites; this is the only gate that pins real, measured
// geometry.
// ---------------------------------------------------------------------------

test.describe('Surround — composed layout gate', () => {
  test.use({ viewport: HD });

  test('the composed layout: the plate straddles, the band overlaps, nothing clips, rail is on the left', async ({ page }) => {
    await openViaUrl(page, ENRICHED_ID);
    await page.waitForSelector('[data-testid="surround-frame"]', { timeout: 20000 });
    // The entrance is a ~400ms staggered transition on the rail, the band and
    // the plate. Measuring mid-flight would read a transformed box, so let the
    // choreography finish before taking any geometry.
    await page.waitForTimeout(1200);

    const box = async (sel) => {
      const b = await page.locator(sel).first().boundingBox();
      expect(b, `${sel} has no box`).not.toBeNull();
      return b;
    };
    const viewport = page.viewportSize();

    // 1. The placard is mounted and STRADDLES the video's top edge — part on the
    //    dark hall above, part over the picture, like a plate pinned to a
    //    painting. (Was: a full-width band sitting entirely above the video.)
    const placard = await box('.surround-frame__header');
    const media = await box('.surround-frame__media');
    expect(
      placard.y + placard.height,
      'the plate does not reach the video — it is a band again, not a plate',
    ).toBeGreaterThan(media.y);
    expect(
      placard.y,
      'the plate starts below the video top — it is not straddling the edge',
    ).toBeLessThan(media.y);

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

    // 3. The playhead never enters the text band. Movement names may now wrap to
    //    two lines, so this reads the heading's REAL box rather than assuming a
    //    single line's height.
    const heading = await box('.surround-movement-map__heading');
    const playhead = await box('.surround-movement-map__playhead');
    expect(
      playhead.y,
      `playhead top ${playhead.y} is inside the heading box (ends ${heading.y + heading.height})`,
    ).toBeGreaterThanOrEqual(heading.y + heading.height - 1);

    //    ...and the lit tip is gone for good: progress is read from the fill.
    expect(
      await page.locator('.surround-movement-map__playhead-edge').count(),
      'the glowing playhead tip is back',
    ).toBe(0);
    expect(
      await page.locator('[data-testid="surround-movement-fill"]').count(),
      'no elapsed fill on the band — progress has nothing to be read from',
    ).toBeGreaterThanOrEqual(1);

    // 4. Every rail child ends on-screen (the bio used to end at 742 of 720).
    //    The nameplate and the country-map are NOT optional for this fixture:
    //    the nameplate always renders in a composer-card rail, and the
    //    country-map is authored in the enriched fixture's live definition —
    //    for both, count===0 is a mount failure, not an absent-content case,
    //    so it must fail loudly rather than be skipped.
    for (const sel of [
      '.surround-composer-card__nameplate',
      '.surround-frame__region[data-module="country-map"]',
    ]) {
      const count = await page.locator(sel).count();
      expect(count, `${sel} did not mount`).toBeGreaterThanOrEqual(1);
      const b = await box(sel);
      expect(b.y + b.height, `${sel} clipped off-screen`).toBeLessThanOrEqual(viewport.height + 1);
    }

    // The fact is the ONE genuinely optional child: a composer without an
    // authored fact renders no fact element at all, so skip only when absent.
    const factCount = await page.locator('.surround-composer-card__fact').count();
    if (factCount > 0) {
      const factBox = await box('.surround-composer-card__fact');
      expect(factBox.y + factBox.height, 'fact clipped off-screen').toBeLessThanOrEqual(viewport.height + 1);
    }

    // 5. The rail is on the LEFT, not the right — the recomposed contract.
    // `regions.right[0].side: 'left'` moves it; the region KEY stays `right`.
    const rail = await box('.surround-frame__rail');
    expect(rail.x + rail.width, 'rail is not entirely left of the video').toBeLessThanOrEqual(media.x + 2);
    expect(rail.width / viewport.width, 'rail is a fifth, not a third').toBeGreaterThan(0.30);
  });
});
