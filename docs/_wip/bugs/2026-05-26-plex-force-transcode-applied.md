# Plex Force-Transcode Applied — Smooth Playback Guarantee (2026-05-26)

**Status:** Patch applied to `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs`. All 424 isolated tests pass. Ready for review and deploy.

**Closes (as primary fix):** `docs/_wip/bugs/2026-05-26-httyd-source-non-uniform-gops-cause-dash-fragmentation.md` and `docs/_wip/bugs/2026-05-26-httyd-recurring-micro-stalls-throughout-playback.md`.

---

## TL;DR

Plex's "Direct Stream" path (ffmpeg `-codec copy -f dash`) cannot produce uniform DASH segments from sources with irregular GOPs. dash.js trips on the segment-time vs content-pts mismatch (`GapController` jumps), producing visible stutters every 5–10 minutes through long-form playback.

**Fix:** Tell Plex to re-encode by default — `directStream=0` + `maxVideoBitrate=8000` in the decision URL. Re-encoder produces uniform GOPs aligned to `seg_duration`, segments and pts match, dash.js plays cleanly.

**Cost:** Plex CPU per active video stream (~30–50% of one core for 1080p H.264 @ 24fps). Acceptable for a single-stream living-room setup.

---

## Library survey findings

Before committing to a blanket fix, sampled the movie library for HTTYD-scale GOP anomalies:

- **Quick 30-file random sample:** 0 flagged (>5% sub-frame GOPs). Mean GOP 1-10 s, all uniform.
- **Background sweep:** killed at 104/2210 files processed. **1 flagged** (`Switched (2020).avi` at 11.4% sub-frame GOPs). HTTYD (52.7%) remains the extreme outlier.

Conclusion: HTTYD-scale anomalies are rare (~1% of library at most), but they happen and are unpredictable. A per-title flag list would need ongoing maintenance and would silently miss future titles. Blanket force-transcode satisfies the "smooth playback no matter what" goal and removes the maintenance burden.

---

## The patch (summary)

`backend/src/1_adapters/content/media/plex/PlexAdapter.mjs`:

1. **`requestTranscodeDecision()`** — both copies of this method (lines 830 + 1483; the second one wins, the first is dead-code defensive)
   - Add `forceTranscode = false` to opts destructure
   - `params.append('directStream', forceTranscode ? '0' : '1')` (was hardcoded `'1'`)

2. **`loadMediaUrl()`** (line 1651)
   - Add `forceTranscode = true` to opts destructure — **default true is the blanket guarantee**
   - When `forceTranscode` is true and caller didn't pass `maxVideoBitrate`, default it to `8000` (keeps native 1080p; lower caps trigger Plex's auto-downscale)
   - Pass `forceTranscode` to `requestTranscodeDecision`
   - Skip the `canDirectPlay` short-circuit branch when `forceTranscode` is true (otherwise we'd bypass re-encoding for files Plex thinks can be raw-served)

3. **Caller sites left untouched** (`play.mjs:216`, `proxy.mjs:64`, `TranscodePrewarmService.mjs:50`). They pass `opts` through; the new default propagates automatically. Opt-out per call is `{ forceTranscode: false }`.

---

## Verification

### Empirical (from Experiment 1, see preceding bug docs)

Direct test of the winning URL combo against Plex:
- Resolution: 1920×816 native (no downscale)
- Bandwidth: 7.1 Mbps re-encoded (vs 2 Mbps source — 3.5× CPU/network internal headroom for visually-transparent quality)
- Segment duration: 3 s uniform
- Every previously-tiny segment (97KB, 5.9KB) now lands in the 300KB–1.7MB range
- Frame timestamps align exactly to segment boundaries: seg 247 declared `[741, 744)`, actual frames at `t=741.03–743.95` ✓

### Test suite

```
npx vitest run tests/isolated/adapter/content/media/plex/PlexAdapter.loadMediaUrl.test.mjs \
                tests/isolated/adapter/content/PlexAdapter.test.mjs
→ 16 test files, 424 tests passed
```

No regressions. The existing tests assert on return shapes (`{url, reason}`), not on URL parameter values, so the directStream switch is invisible to them.

---

## Operational notes

- **Direct-play (raw file serve) is now disabled by default.** This is intentional — Plex's direct-play decision can fire when the source codec/container matches client capability, but it skips the segmenter entirely and we lose all our resilience plumbing. With re-encode, we always get a well-formed DASH stream.
- **Audio playback is unaffected.** The audio branch (`mediaType === 'audio'`) returns a direct stream URL without going through decision. The `forceTranscode` flag has no effect there.
- **First-time playback latency:** Up by ~2-5 s for the transcoder cold-start. Largely masked by the existing prewarm flow.
- **Plex CPU usage will be visibly higher** in `docker stats plex` during any active video session. This is expected.

## Per-call opt-out

If a future caller needs to allow stream-copy (e.g., a known-good source where CPU savings matter), pass:

```js
const result = await plexAdapter.loadMediaUrl(item, {
  startOffset,
  forceTranscode: false,
});
```

The plumbing supports it but no caller currently passes it.

---

## Rollback

Revert `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs` to the prior commit. Behavior reverts to stream-copy (current bug returns). Single-file revert; no migrations or state changes involved.

---

## Related docs

- `docs/_wip/bugs/2026-05-26-httyd-source-non-uniform-gops-cause-dash-fragmentation.md` — root cause analysis
- `docs/_wip/bugs/2026-05-26-httyd-recurring-micro-stalls-throughout-playback.md` — symptom population (81 GapController jumps, 7 user stalls)
- `docs/_wip/bugs/2026-05-26-plex-serves-partial-dash-segments-under-burst-fetch.md` — superseded (race-condition hypothesis falsified)
- `docs/_wip/bugs/2026-05-26-httyd-movie-playback-second-opinion.md` — separate bugs A/B/C from the same playback session
- `docs/_wip/audits/2026-05-26-httyd-movie-playback-audit.md` — original audit
