# Surround Follow-Ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the six items left open after the composed-rail wave — a plate that names the work in full, a centred active segment, and a composer geography that says where people were actually from and what happened there.

**Architecture:** Two independent parts. **Part A (Tasks 1–3)** is frontend chrome — the plate's headline and the rail's active segment — and ships on its own. **Part B (Tasks 4–6)** is corpus geography — a birthplace that carries its country, a map slide for it, and captions that name an event — and also ships on its own. Nothing in B depends on A. Task 0 is a five-minute docs fix that unblocks nobody but is stale and cheap.

**Tech Stack:** React 18 + SCSS (`sass-embedded`), vitest, Playwright-in-vitest for the measurement specs, YAML corpus on a bind-mounted data volume, Express/DDD backend.

## Global Constraints

- **The data volume is not under git.** Back up any corpus file to the session scratchpad before overwriting it. Never `rm` in the data tree — move to `data/_deleteme/` (see `feedback_never_rm_in_data_tree`).
- **`claude` cannot write the data volume.** Write through `sudo docker exec daylight-station sh -c "echo '<base64>' | base64 -d > <path> && chown node:node <path>"`. Command lines above ~100 KB hit `Argument list too long`; chunk with `split -b 30000` and append with `printf '%s' >> /tmp/x.b64`.
- **The store watches mtimes and rebuilds in ~2 s.** Corpus edits need no restart and no redeploy. Verify with `curl -s http://localhost:3111/api/v1/queue/plex:696237`.
- **Deploy gate:** never `sudo deploy-daylight` while `sessionActive:true`, `rosterSize` > 0, or a `videoState:"playing"` with recurring `playback.render_fps`. Check it as its own step; never chain it.
- **Run the suite from the worktree root:** `npx vitest run frontend/src/modules/Surround/`. Baseline is **805 passing, 19 files**. 20 failures in `backend/src/4_api/v1/routers/piano.courses.test.mjs` are pre-existing and unrelated.
- **Facts are verified, never remembered.** Any geography written into the corpus is checked against the offline Wikipedia service (see `CLAUDE.local.md`). The 2026-08-19 expansion showed agents fabricate ~3% of confidently-stated musical facts.
- **Reference doc to update as you go:** `docs/reference/player/surround/classical/README.md`.

---

### Task 0: Refresh the corpus README to the migrated vocabulary

The corpus was migrated to `segments:` (194 files, 0 on `movements:`/`chapters:`) but `data/content/library/classical/README.md` still documents `movements[]` and `chapters`. The corpus now contradicts its own README.

**Files:**
- Modify (data volume): `data/content/library/classical/README.md` — lines mentioning `movements` at 55, 74, 94, 117, 138 and `chapters` at 157, 184

- [ ] **Step 1: Back up the file**

```bash
S=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/content/library/classical/README.md
cp "$S" "$SCRATCH/README.before-key-migration.md"
grep -n "movements\|chapters" "$S"
```

- [ ] **Step 2: Rewrite the key references**

Replace, in this order (each is a whole-word swap, do not touch prose about musical *movements* of a symphony):

| line | from | to |
|---|---|---|
| 55 | `` `<work>.yml` → `movements[].listen:` `` | `` `<work>.yml` → `segments[].listen:` `` |
| 74 | `movements:` | `segments:` |
| 94 | `` `movements[].note:` `` | `` `segments[].note:` `` |
| 117 | `the work's `movements[i]`` | `the work's `segments[i]`` |
| 138 | ``plus `movements`, `facts`,`` | ``plus `segments`, `facts`,`` |
| 157 | `` `chapters`. `` | `` `chapters`. Both are legacy names the store still reads; the corpus is now entirely on `segments:`. `` |

Line 184 ("two chapters of its own text") is prose about a book — leave it.

- [ ] **Step 3: Write it back and verify**

```bash
B64=$(base64 -w0 "$SCRATCH/README.md")
sudo docker exec daylight-station sh -c "echo '$B64' | base64 -d > data/content/library/classical/README.md && chown node:node data/content/library/classical/README.md"
sudo docker exec daylight-station sh -c 'grep -c "movements\[\]\|^movements:" data/content/library/classical/README.md'
```

Expected: `0`

- [ ] **Step 4: Commit** (the README lives on the data volume, so this commit is docs-only)

```bash
git add docs/
git commit -m "docs(surround): the corpus README speaks the migrated vocabulary"
```

---

## PART A — THE CHROME

### Task 1: The plate headlines the work in full

`In C-sharp minor` is right on the rail, because the rail is a contents page and everything on it is understood to be an étude of Op. 10. It is wrong on the plate, which is the surface that says *what you are listening to*, and where that string names nothing.

The discriminator already exists. On a **grouped** rail (a heading spans several segments) the segment's name is scoped by its heading and is a fragment. On a **flat** rail (`railIsFlat`, seven polonaises, one segment each) the segment name is already a whole title and must be left alone.

**Files:**
- Modify: `frontend/src/modules/Surround/modules/WorkPlacard.jsx` — `plateText` (~line 89), the `names` memo (~line 150), the `plateText` call (~line 264)
- Test: `frontend/src/modules/Surround/modules/WorkPlacard.test.jsx`
- Test: `frontend/src/modules/Surround/band.measure.test.jsx` — the polonaise plate block (~line 2261)

**Interfaces:**
- Consumes: `railGroups(placed)`, `railIsFlat(groups)` from `../band.js`; `placedRailSegments(rail)` from `../band.js`
- Produces: `plateText({ piece, segment, ordinal, count, refused, grouped })` — one new boolean parameter, defaulting `false` so every existing caller keeps today's behaviour. Also exports `composedTitle({ segment, grouped })` returning `string`.

- [ ] **Step 1: Write the failing test**

Add to `WorkPlacard.test.jsx`:

```jsx
describe('plateText — a grouped rail needs the whole title', () => {
  const etude = {
    n: 4,
    name: 'In C-sharp minor',
    group: { work: 'chopin/etudes-op-10', title: 'Études, Op. 10', index: 0 },
  };
  const polonaise = {
    n: 1,
    name: 'Polonaise in C-sharp minor, Op. 26 No. 1',
    group: { work: 'chopin/polonaise-op-26-no-1', title: 'Polonaise No. 1 in C-sharp minor, Op. 26 No. 1', index: 0 },
  };

  it('composes the heading, the number and the name on a grouped rail', () => {
    const { title } = plateText({
      piece: { title: 'Études' }, segment: etude, ordinal: 4, count: 27, grouped: true,
    });
    expect(title).toBe('Études, Op. 10 No. 4 in C-sharp minor');
  });

  it('leaves a FLAT rail’s name alone — it is already a whole title', () => {
    const { title } = plateText({
      piece: { title: 'Polonaises' }, segment: polonaise, ordinal: 1, count: 7, grouped: false,
    });
    expect(title).toBe('Polonaise in C-sharp minor, Op. 26 No. 1');
  });

  it('falls back to the segment name when the group has no title to lead with', () => {
    const orphan = { n: 2, name: 'In A minor', group: null };
    const { title } = plateText({
      piece: { title: 'Études' }, segment: orphan, ordinal: 2, count: 27, grouped: true,
    });
    expect(title).toBe('In A minor');
  });

  it('omits the number when the segment has none', () => {
    const { title } = plateText({
      piece: { title: 'Études' }, segment: { ...etude, n: undefined }, ordinal: 4, count: 27, grouped: true,
    });
    expect(title).toBe('Études, Op. 10 — in C-sharp minor');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run frontend/src/modules/Surround/modules/WorkPlacard.test.jsx -t "whole title"`
Expected: FAIL — `expected 'In C-sharp minor' to be 'Études, Op. 10 No. 4 in C-sharp minor'`

- [ ] **Step 3: Implement**

In `WorkPlacard.jsx`, above `plateText`:

```js
/**
 * THE NAME, SET INTO A SENTENCE RATHER THAN AS ITS OWN HEADING.
 *
 * A corpus segment name is written to be read UNDER its heading — `In C-sharp
 * minor`, on a rail whose row above already says `Études, Op. 10`. Promote that
 * to the plate on its own and it names nothing. So the plate re-assembles the
 * three authored pieces the rail keeps apart: the heading, the number, the name.
 *
 * The leading `In` is lowercased because the name stops being a heading the
 * moment it is embedded — `Op. 10 No. 4 In C-sharp minor` reads as two titles
 * jammed together, and every name in the shipped corpus that needs this begins
 * exactly this way. Nothing else about the string is touched.
 */
export function composedTitle({ segment, grouped }) {
  const name = trimmed(segment?.name);
  if (!name) return null;
  const heading = grouped ? trimmed(segment?.group?.title) : null;
  if (!heading) return name;
  const embedded = name.replace(/^In\s/, 'in ');
  const n = Number(segment?.n);
  return Number.isFinite(n) && n > 0
    ? `${heading} No. ${n} ${embedded}`
    : `${heading} — ${embedded}`;
}
```

Then in `plateText`, replace `const name = trimmed(segment?.name);` with:

```js
  const name = composedTitle({ segment, grouped });
```

and add `grouped = false` to its destructured parameters.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run frontend/src/modules/Surround/modules/WorkPlacard.test.jsx`
Expected: PASS

- [ ] **Step 5: Feed the fit the strings it will actually paint**

The plate's type is solved against every name it may carry. Measuring the raw names while painting composed ones would size the plate for the wrong strings. In `WorkPlacard.jsx` replace the `names` memo:

```js
  const grouped = useMemo(
    () => (container ? !railIsFlat(railGroups(drawn)) : false),
    [container, drawn],
  );

  const names = useMemo(
    () => (container
      ? drawn.map(({ segment: m }) => smartQuotes(trimmed(composedTitle({ segment: m, grouped }))))
        .filter(Boolean)
      : []),
    [container, drawn, grouped],
  );
```

Add to the `../band.js` import: `railGroups, railIsFlat`. Pass `grouped` into the `plateText` call:

```js
  const { title, set } = plateText({
    piece, segment, ordinal: index + 1, count: drawn.length, refused, grouped,
  });
```

`refused` compares against the painted string, so update it too:

```js
  const refused = Boolean(segment
    && refusedNames?.has(smartQuotes(trimmed(composedTitle({ segment, grouped })))));
```

- [ ] **Step 6: Run the whole module suite**

Run: `npx vitest run frontend/src/modules/Surround/`
Expected: 19 files pass. If `band.measure.test.jsx`'s polonaise plate block fails, that rail is FLAT and its expectation should be unchanged — investigate rather than editing the expectation.

- [ ] **Step 7: Measure what the composed titles do to the plate's type**

The plate refuses a name it cannot set whole at its 1.5rem floor. Composed titles are 2–3× longer. Add to `band.measure.test.jsx` inside the étude-season describe:

```jsx
    it.each(FLEET)('$name — the composed plate title still sets whole', async ({ width, height, name }) => {
      await layout(page, css, { width, height, data: ETUDE_SEASON, position: ETUDE_PARTS[0].position });
      const plate = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="surround-work-placard"]');
        const title = root.querySelector('[data-testid="surround-placard-title"]');
        return {
          text: title.textContent,
          cutPx: Number((title.scrollWidth - title.clientWidth).toFixed(2)),
          fontPx: Number(parseFloat(getComputedStyle(title).fontSize).toFixed(2)),
        };
      });
      expect(plate.text, `the plate did not compose at ${name}`).toMatch(/Études, Op\. 10 No\. \d+ in /);
      expect(plate.cutPx, `the plate cut its headline at ${name}: ${JSON.stringify(plate)}`).toBe(0);
    }, 60000);
```

- [ ] **Step 8: Run it and record the truth**

Run: `npx vitest run frontend/src/modules/Surround/band.measure.test.jsx -t "composed plate title"`

If a root cuts the title, do **not** relax the assertion. Report the measured `fontPx` and `cutPx` per root and stop — the choice between a smaller plate floor, a shorter composition (drop the opus from the heading), and accepting refusal on the small root is the owner's, not the implementer's.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/modules/Surround/modules/WorkPlacard.jsx \
        frontend/src/modules/Surround/modules/WorkPlacard.test.jsx \
        frontend/src/modules/Surround/band.measure.test.jsx
git commit -m "feat(surround): the plate names the work, the rail names the segment"
```

---

### Task 2: Centre the active segment's label

The sounding segment is opened to ~322px for a ~250px name, and its content is pinned left: the numeral sits in a fixed-width grid track at the far edge and the name starts after it, so the slack piles up on one side and the label sits off-centre in its own lit panel.

**Files:**
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.scss` — `.surround-segment-map__text-row` (~line 350)
- Test: `frontend/src/modules/Surround/band.measure.test.jsx`

**Interfaces:**
- Consumes: `runAccordion(page, { shorts })`, `layout(page, css, {...})`, `FLEET` — all already in `band.measure.test.jsx`
- Produces: nothing importable; this is a stylesheet change asserted by measurement.

- [ ] **Step 1: Write the failing measurement**

Add inside the polonaise short-label describe in `band.measure.test.jsx`:

```jsx
    it.each(FLEET)('$name — the sounding segment’s label is centred in its panel', async ({ width, height, name }) => {
      await layout(page, css, { width, height, data: LABELLED, position: POLONAISE_POSITION });
      await runAccordion(page, { shorts: SHORTS });
      const box = await page.evaluate(() => {
        const seg = [...document.querySelectorAll('.surround-segment-map__segment')]
          .find((s) => s.getAttribute('data-state') === 'active');
        if (!seg) return null;
        const row = seg.querySelector('.surround-segment-map__text-row');
        const s = seg.getBoundingClientRect();
        const r = row.getBoundingClientRect();
        return {
          left: Number((r.left - s.left).toFixed(2)),
          right: Number((s.right - r.right).toFixed(2)),
          segPx: Number(s.width.toFixed(2)),
          rowPx: Number(r.width.toFixed(2)),
        };
      });
      expect(box, 'no sounding segment').not.toBeNull();
      // Centred means the two margins agree. 1px of slack for sub-pixel layout.
      expect(
        Math.abs(box.left - box.right),
        `the label sits off-centre at ${name}: ${JSON.stringify(box)}`,
      ).toBeLessThanOrEqual(1);
    }, 60000);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run frontend/src/modules/Surround/band.measure.test.jsx -t "centred in its panel"`
Expected: FAIL, reporting a large `left`/`right` difference at 1920 (where the rail draws names).

- [ ] **Step 3: Implement**

In `SegmentMap.scss`, on `.surround-segment-map__text-row`, the grid currently fills the segment. Make the ACTIVE segment's row shrink to its content and centre:

```scss
/* THE SOUNDING SEGMENT IS THE ONLY ONE WITH SLACK, so it is the only one that
   can be off-centre. Every other segment is drawn at or near its floor and its
   row fills it exactly. The accordion opens the sounding one to its NAME's
   width plus the rail's own rounding, which leaves a margin that all piled up
   on one side — the numeral's track is at the left edge, so the text drifted
   right of centre inside its own lit panel.
   The row becomes content-width and centres as ONE unit, numeral included: the
   mark belongs to the name, not to the segment's left edge. */
.surround-segment-map__segment--active .surround-segment-map__text-row {
  width: max-content;
  max-width: 100%;
  margin-inline: auto;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run frontend/src/modules/Surround/band.measure.test.jsx -t "centred in its panel"`
Expected: PASS at all three roots.

- [ ] **Step 5: Run the whole module suite**

Run: `npx vitest run frontend/src/modules/Surround/`
Expected: 19 files pass. The playhead is derived from rendered segment WIDTHS, not from the row, so centring cannot move it — if a playhead spec fails, the change leaked into the segment box and must be reverted.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Surround/modules/SegmentMap.scss \
        frontend/src/modules/Surround/band.measure.test.jsx
git commit -m "fix(surround): the sounding label is centred in its own panel"
```

---

### Task 3: Stack the numeral above the name when the band can afford it

**Do this task only after Task 2 is green.** It has a hard prerequisite that must be measured first, not assumed.

The band's whole design rests on every box having a reserved height that cannot change mid-piece. A second line on the sounding segment alone would make the rail taller exactly when a segment starts — the reflow the reserved-height law exists to abolish. So the decision is a constant of the PIECE: the rail stacks only if the region has room for two lines on **every** segment.

**Files:**
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.jsx`
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.scss`
- Test: `frontend/src/modules/Surround/band.measure.test.jsx`

- [ ] **Step 1: Measure the height budget before writing anything**

```jsx
    it.each(FLEET)('$name — how much vertical room the rail actually has', async ({ width, height, name }) => {
      await layout(page, css, { width, height, data: LABELLED, position: POLONAISE_POSITION });
      const room = await page.evaluate(() => {
        const rule = document.querySelector('.surround-segment-map__rule');
        const row = document.querySelector('.surround-segment-map__segment--active .surround-segment-map__text-row');
        const cs = getComputedStyle(row);
        return {
          rulePx: Number(rule.getBoundingClientRect().height.toFixed(2)),
          rowPx: Number(row.getBoundingClientRect().height.toFixed(2)),
          linePx: Number((parseFloat(cs.fontSize) * 1.15).toFixed(2)),
        };
      });
      console.log(name, JSON.stringify(room));
      expect(room.rulePx).toBeGreaterThan(0);
    }, 60000);
```

Run it and read the numbers off the log. **If `rulePx - rowPx < linePx` at any root, stop and report:** the rail cannot stack without growing the band, which is a change to `concert-hall.yml`'s `bottom` region height and an owner's decision. Do not proceed.

- [ ] **Step 2: Only if there is room — write the failing test**

```jsx
    it.each(FLEET)('$name — the numeral sits above the name, both centred', async ({ width, height, name }) => {
      await layout(page, css, { width, height, data: LABELLED, position: POLONAISE_POSITION });
      await runAccordion(page, { shorts: SHORTS });
      const stack = await page.evaluate(() => {
        const seg = [...document.querySelectorAll('.surround-segment-map__segment')]
          .find((s) => s.getAttribute('data-state') === 'active');
        const num = seg.querySelector('.surround-segment-map__numeral').getBoundingClientRect();
        const txt = seg.querySelector('.surround-segment-map__text').getBoundingClientRect();
        return {
          numBottom: Number(num.bottom.toFixed(2)), txtTop: Number(txt.top.toFixed(2)),
          numMid: Number((num.left + num.width / 2).toFixed(2)),
          txtMid: Number((txt.left + txt.width / 2).toFixed(2)),
        };
      });
      expect(stack.numBottom, `the numeral is not above the name at ${name}`)
        .toBeLessThanOrEqual(stack.txtTop + 0.5);
      expect(Math.abs(stack.numMid - stack.txtMid), `the stack is not centred at ${name}`)
        .toBeLessThanOrEqual(1);
    }, 60000);
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run frontend/src/modules/Surround/band.measure.test.jsx -t "numeral sits above"`
Expected: FAIL — the numeral and the name share a baseline, so `numBottom > txtTop`.

- [ ] **Step 4: Implement**

`SegmentMap.scss`:

```scss
/* STACKED, AND ONLY ON THE SOUNDING SEGMENT. The gutter exists so every
   segment shares one text edge; the sounding one has no neighbours to align
   with — it is the only lit box on the rule — so its mark can sit over its
   name instead of beside it. The rail's height does not change: the stack is
   drawn inside the room the rule already reserves, which Step 1 measured. */
.surround-segment-map__segment--active .surround-segment-map__text-row {
  grid-template-columns: minmax(0, 1fr);
  justify-items: center;
  align-items: start;
  row-gap: 0.05em;
}
```

`SegmentMap.jsx` — the numeral currently renders the mark with its point (`numeral()`). Stacked, the point is a joining mark with nothing to join, so use the bare form. Change the active segment's numeral to:

```jsx
<span className="surround-segment-map__numeral">
  {state === 'active' ? numeralText(seg.n, i, style) : numeral(seg.n, i, style)}
</span>
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run frontend/src/modules/Surround/band.measure.test.jsx -t "numeral sits above"`
Expected: PASS

- [ ] **Step 6: Run the whole module suite, then commit**

```bash
npx vitest run frontend/src/modules/Surround/
git add frontend/src/modules/Surround/modules/SegmentMap.jsx \
        frontend/src/modules/Surround/modules/SegmentMap.scss \
        frontend/src/modules/Surround/band.measure.test.jsx
git commit -m "feat(surround): the sounding segment wears its numeral above its name"
```

---

## PART B — THE GEOGRAPHY

### Task 4: A birthplace carries its country

`Żelazowa Wola` names a village nobody can place. All 354 `_composer.yml` files carry a `birthplace:`; only 2 already carry a country.

**The country cannot be derived.** `map.country` is the composer's *adopted* city's country — Chopin's is France — which is exactly wrong for a birthplace, and is the case that prompted this. `nationality` is an adjective and historical borders move. So the country is authored and verified, in batches, against the offline Wikipedia service.

**Files:**
- Modify (data volume): 352 × `data/content/library/classical/**/_composer.yml`
- Modify: `docs/reference/player/surround/classical/README.md` — the composer-file section

- [ ] **Step 1: Extract the work list**

```bash
python3 - << 'PY' > "$SCRATCH/birthplaces.json"
import os, re, json
D='/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/content/library/classical'
out=[]
for root,_,fs in os.walk(D):
    if '_composer.yml' not in fs: continue
    p=os.path.join(root,'_composer.yml'); t=open(p,encoding='utf-8').read()
    bp=re.search(r'^birthplace:\s*(.+?)\s*$', t, re.M)
    nm=re.search(r'^name:\s*(.+?)\s*$', t, re.M)
    if not bp: continue
    out.append({'file':os.path.relpath(p,D),'composer':nm.group(1) if nm else None,
                'birthplace':bp.group(1).strip('"\''),'hasComma':',' in bp.group(1)})
print(json.dumps(out, ensure_ascii=False, indent=1))
PY
```

- [ ] **Step 2: Verify each country against the offline Wikipedia, in batches of ~30**

For each composer, query the local Wikipedia service (host in `CLAUDE.local.md`) for the composer's article and read the birthplace from it. Record `{file, birthplace, country, source}`. Rules:
- Use the **modern** country name, spelled as the Natural Earth geodata spells it (`United Kingdom`, `Czechia`) — the same spelling `map.country` must use, because Task 5 pins a map with it.
- Where the birth town's country has changed since, write the modern one and note the historical one in the composer's `facts:` instead. A birthplace line is a locator, not a history lesson.
- **Anything you cannot confirm, leave alone** and list it. A wrong country is worse than a bare town.

- [ ] **Step 3: Stage every rewrite on the host and validate before writing**

```bash
python3 - << 'PY'
import json, pathlib, re, os
SRC='/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/content/library/classical'
plan=json.load(open(os.environ['SCRATCH']+'/verified.json'))
out=pathlib.Path(os.environ['SCRATCH'],'composers'); out.mkdir(parents=True,exist_ok=True)
for e in plan:
    p=pathlib.Path(SRC,e['file']); t=p.read_text(encoding='utf-8')
    old=re.search(r'^birthplace:\s*(.+?)\s*$', t, re.M)
    assert old, e['file']
    if ',' in old.group(1): continue                    # already located
    new=t[:old.start()] + f'birthplace: "{e["birthplace"]}, {e["country"]}"' + t[old.end():]
    lines_changed=sum(1 for a,b in zip(t.split('\n'), new.split('\n')) if a!=b)
    assert lines_changed==1, f'{e["file"]}: {lines_changed} lines changed'
    d=out/e['file']; d.parent.mkdir(parents=True,exist_ok=True); d.write_text(new,encoding='utf-8')
print('staged', len(list(out.rglob('_composer.yml'))))
PY
```

Then parse every staged file with `js-yaml` and assert: it loads; `birthplace` now contains a comma; **every other field is byte-identical** to the original.

- [ ] **Step 4: Back up, then write in chunks**

```bash
(cd "$SRC" && tar czf - -T "$SCRATCH/files.txt") > "$SCRATCH/backup/composers.tgz"
tar tzf "$SCRATCH/backup/composers.tgz" | wc -l    # must equal the staged count
# then: tar the staged tree, base64, split -b 30000, printf-append into /tmp/c.b64,
# base64 -d | tar xzf - -C data/content/library/classical, chown -R node:node
```

- [ ] **Step 5: Verify live**

```bash
curl -s "http://localhost:3111/api/v1/queue/plex:696237" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      console.log(JSON.parse(d).items[0].surround.composer.birthplace)})'
```

Expected: `Żelazowa Wola, Poland`

- [ ] **Step 6: Document and commit**

Update the composer-file example in `docs/reference/player/surround/classical/README.md` to `birthplace: Bonn, Germany` and add: *"A birthplace is a locator, so it carries its modern country, spelled as the geodata spells it. Where the border has moved since, the modern name goes here and the history goes in `facts:`."*

```bash
git add docs/reference/player/surround/classical/README.md
git commit -m "docs(surround): a birthplace carries its country"
```

---

### Task 5: A birthplace map slide

The carousel maps the composer's adopted city four ways and never shows where they were from. Chopin's rail shows France, and Poland — the country his whole story is about — never appears.

**Files:**
- Modify (data volume): `_composer.yml` for the flagship composers only — Bach, Beethoven, Mozart, Sibelius, Wagner, Handel, Vivaldi, Chopin
- Modify: `frontend/src/modules/Surround/modules/CountryMapModule.jsx` — add `birthPinFrom`
- Modify: `frontend/src/modules/Surround/modules/PlaceCarousel.jsx` — the `slides` memo (~line 89)
- Test: `frontend/src/modules/Surround/modules/PlaceCarousel.test.jsx`
- Modify: `docs/reference/player/surround/classical/README.md`

**Interfaces:**
- Consumes: `mapPinFrom(data)` → `{country, city, lat, lon} | null`
- Produces: `birthPinFrom(data)` → the same shape, read from `composer.birth_map`, or `null`. No allowlist change is needed: the store deep-merges the whole `_composer.yml` into `composer`, so a new key reaches the payload untouched.

- [ ] **Step 1: Author `birth_map:` for the eight flagship composers**

```yaml
birth_map: { country: Poland, city: Żelazowa Wola, lat: 52.26, lon: 20.39 }
```

Every coordinate verified against the offline Wikipedia. Country spelled as the geodata spells it — a name absent from `europe.geo.json` logs `surround.map.country-missing` and draws nothing.

- [ ] **Step 2: Write the failing test**

The carousel shows ONE slide at a time and cycles, so the sequence is read by
advancing the dwell — the idiom the file already uses (`PLACE_SLIDE_MS` then
`DISSOLVE_COMMIT_MS`, inside `act`). Add this helper beside `renderCarousel`:

```jsx
/** The slide sequence, read the way the dwell would show it. */
const slideSequence = (view, n) => {
  const seen = [view.kind()];
  for (let i = 1; i < n; i += 1) {
    act(() => { vi.advanceTimersByTime(PLACE_SLIDE_MS); });
    act(() => { vi.advanceTimersByTime(DISSOLVE_COMMIT_MS); });
    seen.push(view.kind());
  }
  return seen;
};

const CHOPIN = {
  contentId: 'plex:1',
  composer: {
    name: 'Frédéric Chopin', birthplace: 'Żelazowa Wola, Poland',
    map: { country: 'France', city: 'Paris', lat: 48.85, lon: 2.35 },
    birth_map: { country: 'Poland', city: 'Żelazowa Wola', lat: 52.26, lon: 20.39 },
  },
};
```

and the tests:

```jsx
it('draws a birthplace slide, before the adopted city’s', () => {
  vi.useFakeTimers();
  try {
    const view = renderCarousel({ data: CHOPIN });
    const seen = slideSequence(view, 4);
    expect(seen, `slides seen: ${JSON.stringify(seen)}`).toContain('birth-map');
    expect(seen.indexOf('birth-map')).toBeLessThan(seen.indexOf('map'));
  } finally {
    vi.useRealTimers();
  }
});

it('renders no birthplace slide when none is authored', () => {
  vi.useFakeTimers();
  try {
    const bare = { ...CHOPIN, composer: { ...CHOPIN.composer, birth_map: undefined } };
    const view = renderCarousel({ data: bare });
    expect(slideSequence(view, 4)).not.toContain('birth-map');
  } finally {
    vi.useRealTimers();
  }
});
```

`kind()` reads the carousel's `data-slide` attribute, so the implementation must
set it to `birth-map` for this slide — check that `PlaceCarousel.jsx` publishes
`data-slide` from the slide's `key` and not from a hardcoded list.

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run frontend/src/modules/Surround/modules/PlaceCarousel.test.jsx -t "birthplace slide"`
Expected: FAIL — `expected [ 'photo', 'map', 'city-map', 'era' ] to contain 'birth-map'`

- [ ] **Step 4: Implement**

In `CountryMapModule.jsx`, beside `mapPinFrom`:

```js
/**
 * WHERE THE COMPOSER WAS FROM, as against where they ended up.
 *
 * `map:` is the adopted city — Chopin's is Paris — so a carousel built from it
 * alone maps France four ways and never shows Poland. This reads the separate
 * `birth_map:` block, and returns null where nobody authored one, which is most
 * of the corpus: the slide is added where the knowledge exists, never guessed.
 */
export function birthPinFrom(data) {
  const map = data?.composer?.birth_map ?? null;
  const country = typeof map?.country === 'string' && map.country.trim() ? map.country.trim() : null;
  if (!country) return null;
  return {
    country,
    city: typeof map?.city === 'string' && map.city.trim() ? map.city.trim() : null,
    lat: coord(map?.lat),
    lon: coord(map?.lon),
  };
}
```

In `PlaceCarousel.jsx`, immediately before the `const pin = mapPinFrom(data);` block:

```js
    // THE BIRTHPLACE COMES FIRST, because the carousel tells a life in order:
    // where they were from, then where they went, then when they lived.
    const birth = birthPinFrom(data);
    if (birth) {
      built.push({
        key: 'birth-map', kind: 'birth-map', pin: birth, zoom: 'region',
        caption: birth.country, captionKind: 'label',
      });
    }
```

**`kind` is the slide's identity here, not `key`.** The carousel publishes
`data-slide={shown.kind}` (line 244) and picks its renderer by `kind` (lines
253–261), which is why the zoomed city slide is `kind: 'city-map'` rather than
another `'map'`. So the birth slide takes `kind: 'birth-map'` — and the render
branch must treat it as a map. The `else` arm already renders a map for anything
that is not `photo` or `era`, so confirm that by reading lines 250–275 before
assuming it; if the branch enumerates kinds explicitly, add `birth-map` beside
`map` and `city-map`. The mat class `--birth-map` will need the same rule as
`--map` in `PlaceCarousel.scss`.

- [ ] **Step 5: Run it, run the suite, commit**

```bash
npx vitest run frontend/src/modules/Surround/
git add frontend/src/modules/Surround/modules/CountryMapModule.jsx \
        frontend/src/modules/Surround/modules/PlaceCarousel.jsx \
        frontend/src/modules/Surround/modules/PlaceCarousel.test.jsx
git commit -m "feat(surround): the carousel shows where the composer was from"
```

---

### Task 6: Every map says what happened there

A map captioned `PARIS` names a place. The band's voice everywhere else is a sentence, and a map slide should make a claim: *Chopin was born in Żelazowa Wola, Poland.*

**Files:**
- Modify: `frontend/src/modules/Surround/modules/PlaceCarousel.jsx`
- Test: `frontend/src/modules/Surround/modules/PlaceCarousel.test.jsx`
- Modify: `docs/reference/player/surround/classical/README.md`

**Interfaces:**
- Produces: `placeSentence({ kind, composer, piece, pin })` → `string | null`, exported from `PlaceCarousel.jsx` (which today exports only `PLACE_SLIDE_MS`, `PLACE_FADE_MS` and the default). Add it to the test file's import:
  `import PlaceCarousel, { PLACE_SLIDE_MS, PLACE_FADE_MS, placeSentence } from './PlaceCarousel.jsx';`

- [ ] **Step 1: Write the failing test**

```jsx
describe('placeSentence', () => {
  const composer = { name: 'Frédéric Chopin', birthplace: 'Żelazowa Wola, Poland' };

  it('says where the composer was born', () => {
    expect(placeSentence({ kind: 'birth-map', composer, pin: { city: 'Żelazowa Wola', country: 'Poland' } }))
      .toBe('Chopin was born in Żelazowa Wola, Poland.');
  });

  it('says where the work was composed', () => {
    expect(placeSentence({ kind: 'map', composer, piece: { title: 'Études, Op. 10', city: 'Paris' },
      pin: { city: 'Paris', country: 'France' } }))
      .toBe('Études, Op. 10 was composed in Paris.');
  });

  it('falls back to the place alone when there is no event to name', () => {
    expect(placeSentence({ kind: 'map', composer, piece: {}, pin: { city: null, country: 'France' } }))
      .toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run frontend/src/modules/Surround/modules/PlaceCarousel.test.jsx -t "placeSentence"`
Expected: FAIL — `placeSentence is not a function`

- [ ] **Step 3: Implement**

```js
/** A composer's surname — what a caption calls them after the card has named them in full. */
const surname = (name) => {
  const parts = String(name ?? '').trim().split(/\s+/);
  return parts.length ? parts[parts.length - 1] : null;
};

/**
 * WHAT HAPPENED HERE — the caption as a claim rather than a label.
 *
 * A map captioned `PARIS` names a place and says nothing about why the frame is
 * showing it. Everywhere else the band speaks in sentences, and a place slide
 * has a sentence available: the composer was born somewhere, the work was
 * written somewhere. Only the two the corpus actually knows are written; a slide
 * with no event to name returns null and the caller keeps the bare label.
 */
export function placeSentence({ kind, composer, piece, pin }) {
  const where = [pin?.city, pin?.country].filter(Boolean).join(', ');
  if (!where) return null;
  if (kind === 'birth-map') {
    const who = surname(composer?.name);
    return who ? `${who} was born in ${where}.` : null;
  }
  const work = typeof piece?.title === 'string' && piece.title.trim() ? piece.title.trim() : null;
  if (kind === 'map' && work && pin?.city) return `${work} was composed in ${pin.city}.`;
  return null;
}
```

Then in the `slides` memo, replace each map slide's `caption`/`captionKind` with:

```js
      const sentence = placeSentence({ kind: 'birth-map', composer, piece: data?.piece, pin: birth });
      built.push({
        key: 'birth-map', kind: 'map', pin: birth, zoom: 'region',
        caption: sentence ?? birth.country,
        captionKind: sentence ? 'sentence' : 'label',
      });
```

and the same shape for the `map` slide. Leave `city-map` on its bare city label: it answers "where in the country", and a second sentence one slide later reads as repetition.

- [ ] **Step 4: Run it, run the suite, commit**

```bash
npx vitest run frontend/src/modules/Surround/
git add frontend/src/modules/Surround/modules/PlaceCarousel.jsx \
        frontend/src/modules/Surround/modules/PlaceCarousel.test.jsx
git commit -m "feat(surround): a map slide says what happened there"
```

- [ ] **Step 5: Document the new corpus keys**

In `docs/reference/player/surround/classical/README.md`, under the composer file, add `birth_map:` beside `map:` with the note that `map:` is the adopted city and `birth_map:` the birthplace, that both need geodata-spelled country names, and that a slide is drawn only where the block exists.

```bash
git add docs/reference/player/surround/classical/README.md
git commit -m "docs(surround): birth_map, and what each map slide claims"
```

---

## Ship

- [ ] Run `npx vitest run frontend/src/modules/Surround/` — 19 files, ≥805 tests
- [ ] **Deploy gate as its own step.** Confirm `sessionActive:false`, `rosterSize:0`, no `videoState:"playing"`. If blocked, wait.
- [ ] `./scripts/build-daylight.sh`
- [ ] `sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight`
- [ ] Verify `curl -s http://localhost:3111/build.txt` matches HEAD
- [ ] Re-dispatch the office (`/api/v1/device/office-tv/load?queue=plex:696233`) and read the rail back over CDP. **The office player does not render into the `/screen/office` CDP tab** — the device session (`/api/v1/device/office-tv/session`) is the authoritative source for what is playing.
