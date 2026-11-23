# Content filter: the review page

The Admin page where a grown-up reviews one film's filtered parts (Admin → Content filter → a film).
The rest of the content filter (pipeline, EDL, player, workshop API) is in
[content-filter.md](./content-filter.md).

## The review page (2026-11-21, design "cf-journey")

The page is a queue of the film's **filtered** parts with one part in hand. `ReviewHeader.jsx` is its
one line: ‹ Films, the title, a red chip for a
failed or interrupted last run, an orange alert for a run that may be stuck, and one action: **Stop**
while a run is open, else **Refine all r** (Shift+R) on the Refine tab while filtered parts are
rough. It carries no status badge: where the film stands is said once, by the rail. The ⋯ menu holds
Refine all filtered parts again, Refine the whole film (every part, slow), "Re-refine N parts marked
Redo" (only while some are), bleep quieter/louder and All keys. A film not matched to Plex offers
no runs. The page uses the whole window (no 1200 px page cap); the list column grows with it
(380 px to 520 px).

**Stage rail** (`ReviewRail.jsx`, `railStages.js`; owner 2026-11-22: "a process chevron interlocking
rail that also serves as tabs"). Directly under the header, one 36 px row: three interlocking
chevrons, **Refine › Review › Approve**, then a plain tab **Plays n**. The chevrons are both the
film's progress and the page's navigation (`role="tablist"` / `tab`, `aria-selected`, roving focus;
← → Home End move between tabs while one has focus; a click does not keep focus, so ← → go on
stepping through parts). It replaced the "Refine first" line under the header and the list's
Filtered / Plays control.

| Stage | What it says (`railStages`) | Selecting it shows |
|-------|-----------------------------|--------------------|
| Refine | "16 to refine"; the run's own words while one is open (`runState`: "Refining 10 of 18 · about 4 min left"); "Stuck: no progress for 45 min" / "Filter worker not running"; "Done", or "7 with unsure timing" with an amber "!" in place of the check while parts refine could not vouch for wait for a look ("15 to refine · 1 timing unsure" while both remain); "Not refined yet"; "… not matched to Plex" | The filtered parts on rough timing or with a `refine-*` reason (never a true scene) plus any part in a refine or queued for one. The header's Refine all sits here; the card shows no verdict buttons |
| Review | "0 of 16 reviewed" (with "· refine first" while refine has parts left); "Nothing is filtered"; with no parts yet, why ("Checking the result…", "Nothing until the film is refined") | The filtered parts: Not reviewed only, order |
| Approve | "Not yet: " + the first `signOff.missing` line; "Ready"; "Approved by …" | The sign-off panel in place of the part card (`ApprovePanel`): what is missing with a **Review the N parts without a verdict** button back to Review, **Approve for family** when the sign-off would be accepted, or Withdraw approval |
| Plays n | the count | The parts that play (browse only) |

Each stage has one state, from the data alone: **complete** (green check), **current** (filled: the
first stage still to do, or Approve when it is ready), **waiting** (muted, with the reason in its
text) or **stuck** (orange, from `runState().stuck`; the full sentence is its tooltip and the
header's alert). The open tab carries a bar along its bottom edge, so "where the film is" and "what I
am looking at" are separate marks. The film opens on its first stage still to do (`defaultStage`;
a finished film on Approve; a permalink on the tab its part is on); after that the tab is the
reviewer's choice and a stage finishing never moves it. The tab is the review scope's `stage`
(`reviewScope.js` `stageScope`), so the list, the timeline and stepping follow from one value; when
the part in hand is not among the new tab's parts, the first open one is taken in hand. On Approve
the part card is not on screen, so the part keys are off (`useReviewKeys` `partKeys: false`); Space
still plays and pauses the film and `?` lists the keys. Picking a part from the list or the
timeline goes back to Review (or Plays).

**Reviewed or not** (owner, 2026-11-22: "verified or not"). A part's status is one of **Not
reviewed**, **Approved**, **Let play** or **Redo** (and Plays for a part that plays); there is no
"To do" / "Check" split. A filtered part refine left a `refine-*` reason on (word not found, coarse
edges, unknown) keeps that doubt on its **timing**: the list's timing icon and the card's timing chip
are amber, in words ("Word not found", "Rough after refine", "Timing unsure", tooltip "Timing
unsure: listen before approving"), never a green "Safe window". The rail still counts these parts
(`reviewScope.js` `needsCheck`) as "n with unsure timing". Every tab change logs
`content_filter.review.stage_tab` (`stage`, `from`, `via`: default / click / key / part, `shown`).

**Layout** (Fable design 2026-11-22, owner: "no vertical scroll at all"). The page is exactly the
window: `.cf-review-page` is `100dvh` less the Admin breadcrumb bar and 24 px of padding, and
nothing scrolls but the list's rows. At 1440x900: header 40, rail 36, then a 736 px work area of the
film (`minmax(0, 1fr)`, 16:9, about 668x388), the two timeline lanes (Film and Near, 24 px each),
and the 280 px part card; the list is `clamp(380px, 30vw, 520px)` wide. Arriving without a
permalink selects the first part still to do on the opening tab (no URL change) and puts the film
4 s before it, **paused** (`previewStore.jumpToCue(cue, { play: false })`). A paused film is the
frame under review, so the Player's pause overlay is a small corner badge and nothing dims the
picture (scoped CSS under `.cf-review__player`).

**Focus.** Only controls take focus; a pointer press on a button, mark, handle, track or the player
never moves focus (`.cf-review-page` mousedown), so Space always pauses and outlines nothing; a ring
shows only for the keyboard (`:focus-visible`). Text fields and menus keep their own focus.

**Timeline** (`ReviewTimeline.jsx`): two lanes, **Film** (the whole film) and **Near** (90 s around
the part in hand; its range is the label's tooltip, so the label never changes width). Everything
on a lane goes somewhere when clicked (owner: "anything on a timeline, you click it, it should go
there"): a mark, or a click within 6 px of one, takes that part and seeks to it; a click on empty
track seeks the film to that time and keeps the part in hand. Each mark has a 12 px hit pad; both
lanes draw the film's playhead, and the Film lane runs to the film's real end
(`previewStore.duration`), not to its last part.

**List** (`ReviewList.jsx`): one 32 px line per part (status, time, effect and channel icons,
label, status word, timing icon; "Not reviewed" is the hollow circle alone, its word for screen
readers), the part in hand marked but never expanded (the card carries its details). The **effect
icon is a control**: it takes that row in hand and opens the effect menu (it stays shut when the
pick is refused, e.g. while unsaved timing holds the cursor).

**Part card** (`RowEditor.jsx`), one 280 px panel of five lines, none of which grows:

1. **Identity**: the **effect button** (icon, word, ▾, `E`) that opens the **effect menu**; the
   label (two lines at most, the span in its tooltip); the channel icon (group and channel in its
   tooltip); the timing chip; `5/17`; ‹ › (← →).
2. **Why** (`whyLine.js`, one line, full text in its tooltip) and **Refine (R)**: filled only when
   refining is the fix, a quiet "Refine again" once refine has tried the part, its run state in
   place of the button (Waiting / Refining… / Queued).
3. **Timing**: the strip. There is no Save step: a drag, a ← → nudge or I / O saves itself 0.5 s after
   the last move (never while the pointer is still down), shown as "Saving…" and an amber pulsing
   marker under the band that settles to grey. Beside it: **Undo** (the last autosaves of this part,
   back to what each replaced, or to the measured timing if the part had no hand fix) and **Reset**
   (drop the hand fix). A refused save shows its message and is not retried on the same draft. Each band carries its part's label (the word to listen for;
   an ellipsis when narrow, full name on hover).
4. **Actions**: ▶ (Space), **Filtered (Enter)**, **Unfiltered (W)** | **Approve (A)**, **Let it play
   (X)**, **Redo (D)** (the reason prompt), ↶ (U). On the Refine tab there are no verdict buttons.

**Button roles** (one decision per card). Exactly one button is **primary** (filled): **Approve**
while the part has no verdict. The rest are
**secondary** (outlined: the other verdicts, the play buttons) or **tool** (quiet: Undo, Reset,
↶). A chosen verdict stays visible as a ring plus a check on its button (`aria-pressed`), not as a
second filled button. Only gray buttons get a gray border.
5. **Status** (40 px): the station's last message, the redo reasons (one line), notices and run
   notes. On a card narrower than 600 px (a 1280 window) the play buttons drop their key labels
   (their tooltips keep them) before anything is clipped.

The **effect menu** (`EffectMenu.jsx`; a menu, not a cycle, so no effect is saved on the way): the
effects that fit the part's channel with their keys (said `M` mute, `P` bleep, `K` skip, `F` off;
shown `B` blur, `H` hide picture, `K` skip, `F` off; true scenes `K` skip, `B` hide picture, `F`
off; `O` is the out point), the current one checked; then **Use household settings**; for a word, **More for this
word…** (a popover: this word in this film, Settings / Play / Mute / Bleep, and all of its group in
this film); for a skip, the card shown in place of it (a popover with Approve card, Draft,
Withdraw). The effect keys work with the menu closed and inside it (a letter picks and closes it).
While any menu is open the station keys stand aside entirely, Esc included: Esc closes the menu and
nothing else (it used to drop an unsaved timing change behind an open menu). A word skipped as an exchange is listed with
scenes but is a cue: `isSceneRow` (no members, not `cue:`) decides scene handling, `keysKindOf` the
effect keys.

The **part menu** (`PartMenu.jsx`; owner, 2026-11-22: "right-click and I can change what it is or
how it's handled"): a right-click on a part anywhere it appears (a list row, a timeline mark, a
band on the timing strip, the part in hand's or a neighbour's; the strip finds the band by time,
and empty track keeps the browser's menu), or the context-menu key / Shift+F10 on a focused list
row, opens one menu for that part. It takes the part in hand first (`pickPart`; when the pick is
refused, e.g. by unsaved timing, the menu stays shut). It names the part and its time, then
**Play filtered (↵)**, **Play unfiltered (W)**, **Jump to it**; the effects that fit with their keys
(current checked; off reads "No effect") and **Use household settings** (`station.handlers.settings`,
the same `{ effect: 'profile', disabled: false }` PUT as the card's menu); **Approve (A)**, **Let it
play (X)**, **Redo (D)** (the reason prompt, as the Redo button) unless the part plays; **Refine
(R)** unless it plays or is a true scene; **Set in point here (I)** / **Set out point here (O)** for
a single cue. The keys work inside the menu (Enter is Play filtered unless an item has focus). An
item runs on the next render, through the same handlers as the keys, and only if that part is still
in hand: a cursor that moved meanwhile (a verdict's save stepping on) drops it
(`content_filter.review.part_menu.dropped`), so it never fires on a later visit. Logs `content_filter.review.part_menu` (`rowId`, `from`:
list | timeline | strip | key) and `content_filter.review.part_menu.action` (`action`, `value`).

**Unfiltered (W)** plays the part from 4 s before with its effect off (`previewStore.peek`). The
player reports the peek (its peek set publishes `peeking` to the preview store when it starts and
when the playhead passes the part), and while it is on the player carries an amber **Unfiltered**
badge and outline and the button is pressed (`content_filter.review.unfiltered`). Filtered (Enter),
stepping and picking a part end a peek at once (`previewStore.unpeek`).

**Refine** (`useReviewStation.js`): R sends a send-back of the part's member cues (on a hand-fixed
part, the first R warns that refining drops the hand fix and the second sends); Shift+R (on any tab),
the Refine tab's Refine all button and the overflow Refine all again send one send-back of their filtered, non-scene
targets (rough timing for Shift+R, every filtered part for Refine all again), never the parts that
play. The overflow count and disabled state use that same eligible target set, so scene-only films
do not offer an empty refinement. If any bulk target contains hand-fixed timing, the first action warns and the same action a
second time within four seconds confirms the exact target before sending or queueing it. One run per
film: presses while a run is open collect on the page ("Queued") and go out as one send-back only
when the run finishes
`done`; after a stopped or failed run they stay queued and the page says so (the next R sends them).
A refine moves a part, which drops its verdict, so a part being refined takes no verdict ("Give it a
verdict when the new timing lands") and auto-advance skips it. While filtered parts are rough, the
rail's Review stage reads "· refine first" and the Refine tab says verdicts are given on the Review
tab (a verdict resets when its part is refined); the sign-off lists "Refine the filtered parts first:
approval needs their measured timing" for an unrefined film. A rough part refine already tried (it carries a
`refine-*` reason: not found, coarse edges) is not refined again by Refine all, and its card never
pushes Refine: the Refine stage counts it as to check (above), and it never holds back the Approve stage
(review 2026-11-22: Sonic's picture parts keep coarse edges, so "Refine all 5" looped). Keys on a part that plays send nothing (it needs no verdict and is
not refined); R on a part waiting in the page's queue takes it out again. A send-back
on an already synced film takes about 10 s per part (measured: preflight 2 s, refine 5 s, audit
1 s); a film's first refine transcribes it once. The transcript's decode is judged against the audio stream's own
end (its last packet), not the container's duration: a film whose picture or subtitle track runs on
past its sound (Sonic: audio ends 12 s before the picture) used to fail "audio decode stayed short".

**A run never claims progress it does not have** (owner, 2026-11-22: "if stuck you need guardrails,
the UI should never lie"). The 480p film copy's lock holds its builder's pid: a lock whose holder is
gone is taken at once (a worker restart had left one that a refine waited on for hours; the age rule,
3 h, stays as a backstop). Refine announces "Waiting for the film copy" / "Making the film copy" on
stderr (also after the transcript, if the copy is not ready), and these are progress phases
(`copy-wait`, `copy`). The Refine stage's text (`runState`) names the real step (Waiting for the film
copy, Making a small copy of the film, Transcribing the film, Lining up the film's clock, Refining n
of N), how long it has been in it, and past the longest that step takes (copy-wait 30 min, copy 45,
transcribe 150, sync 10, a part 10, other 20) the stage turns orange ("Stuck: no progress for …") and
the header shows an orange alert: "…: no progress for
2 h 29 min. It may be stuck; Stop it and refine again." A queued run with no live worker is flagged too.

While a remote worker holds the film, a plain verdict (approve/redo/ignore, no change) may still be
recorded (`jobs.heldRemotely`); Let it play and Undo answer 409 "A refine is running on this film.
Approve and Redo work now; Let it play and Undo wait until it finishes.", effects, timing and cards
"… can change when it finishes." On the card a run locks only effects, timing and card text. The
worker's override is saved with the current file's review marks kept (`applyResults`), through the
same per-film write queue as verdicts (`titleQueue`), so a verdict cannot land between its read and
its write.

**Timing strip** (`TimingStrip.jsx`; owner 2026-11-22: "a mini timeline with handlebars i can
drag", and Fable design 2026-11-22). It fills its grid cell (the strip track is about 500 px for a
12 s window at 1440x900) and carries **no timecode readout**: the readout changed width and shook
the row. A window around the part (the part ± 6 s, or ± half its length for a long one, at least
12 s wide) with a tick every second and a label every 5 s (coarser on long windows); the part in
hand as a solid band with white handles; **every other filtered part that overlaps the window** in
its effect family's colour (owner: two bleeps close together must both show and be adjustable),
one-cue neighbours with their own thinner handles, multi-cue ones hatched with none; the film's
playhead (amber, read every 100 ms) and, once the span is edited, a thin line where the saved span
is. The track decides which handle a press means: the nearest edge within 12 px (a press farther
away is a click, which seeks), so two close parts never steal each other's handles; a drag stops at
the next part in the window, never crossing it; a grab keeps its offset (the edge does not jump
to the pointer); while dragging, a bubble shows the edge's time and the paused film follows the
handle (`previewStore.seekTo`, every 100 ms). The window holds still during a drag and widens by
3 s when a handle is let go at its edge. Keyboard: Tab to a handle (`role="slider"`, "Start" / "End",
a neighbour's "heck: Start"): `←` `→` move it 0.1 s, with Shift 0.5 s, `Home` / `End` put it at the
playhead, `Esc` lets go of it. The start stays at least 0.05 s before the end. A click on the strip
seeks the film there. While a handle has keyboard focus the station's `←` `→` do not step parts; a
handle dragged with the pointer takes no focus. Every dragged span is a draft for 0.5 s, then the autosave writes each changed part (`nudge: { in, out }` to `PUT /:rk/cues/:id` or `/scenes/:id`), as
one action; a run locks the strip with the rest of the timing.

**Unsaved timing holds the cursor.** While any span in the strip differs from its saved one, stepping (keys,
‹ ›), picking another part (list, timeline), changing tab, a verdict, Undo and Refine all
stop with "Unsaved timing: Save or press Esc to drop it" (`content_filter.review.unsaved_timing_blocked`,
`what`); `Esc` drops the change (`…unsaved_timing_dropped`). Nothing is discarded without a word.

**List** (`ReviewList.jsx`, `partVisuals.jsx`): the parts of the rail tab in hand (on Plays: "Nothing
here needs a verdict"; on Refine: what refine does, and "Nothing is left to refine." when empty); "To
do only" (on Review only); Film order (default) or Needs a look first; and **?**, the icon key. A part
is one line (owner 2026-11-22: "more compact, better icon usage, better visual language"): a status
icon, its time (`m:ss.s`, `h:mm:ss.s` from an hour on), its effect and channel icons, its label on one
line, the status in a word on every row (`rowStatus`: To do, Check, Approved, Let play, Redo, Ignored,
Plays; owner: an icon "should have a word too"),
and its timing mark, or a spinner / clock while it is in a refine. The part in hand opens to its
whole label and the same facts in words (span · group · said/shown · effect, its timing, unsure
reasons, card). Icons are Tabler SVGs, each with its word as tooltip and accessible name.

| Meaning | Icon | Colour |
|---------|------|--------|
| To do / Check / Approved / Let play / Redo / Plays | circle / alert triangle / circle-check / filter-off / refresh / play | white / amber / green / green / orange / grey |
| Muted, Bleeped | volume-off, wave | audio (`--cf-fx-audio`) |
| Blurred, Picture hidden | blur, eye-off | picture (`--cf-fx-picture`) |
| Skipped | skip-forward | skip (`--cf-fx-skip`) |
| Said / Heard / Shown | message / ear / eye | grey |
| Refined / Safe window | target / brackets | green / grey |
| Rough / unsure after refine (Rough after refine, Word not found, Check timing) | dashed circle / alert triangle | orange |
| Refining / Waiting, Queued | spinner / clock | blue |

**Colour roles.** One colour language across the page. **Green is done** (approved, refined, a stage
complete). **Orange is redo or needs a look** (Redo, rough or unsure timing, a stuck run). **Effect
families** each own one colour in the list's icons, the part card's effect button and the
timeline's and strip's marks: audio (mute, bleep), picture (blur, hide), skip. **Chips are neutral**
(grey text on a neutral pill); only a chip's icon carries a colour (for timing, `.cf-ico--timing`
with `is-unsure` for amber), so a row of chips never competes with the verdict colours. Grey plays
or has nothing to say; the accent blue is the stage in hand and the selection.

## Review station

One capture-phase listener owns the keys (they work while the video has focus; never inside text
inputs or an open dialog). `ReviewKeyBar.jsx` under the card is only the redo prompt, the station's
last message, the preview retry and the `?` keymap sheet.

- **Keys.** `Space` play/pause the film, always (a focused button is blurred, never pressed);
  `Enter` play the part with its effect from 4 s before (a focused button or link keeps Enter);
  `W` play it without the effect; `→` / `←` next / previous part; `A` approve; `X` let it play
  (remove); `D` redo, then `1` edges, `2` category, `3` action, `4` timing or `Enter` for none;
  `U` undo; `R` refine this part; `I` / `O` set the single cue's in / out point at the playhead (as
  drafts: nothing is written until `S` saves, and `F` is the filter-off effect key, not an out
  point); `S` save the timing; `Shift+R` refine every rough filtered part; effect keys as above;
  `[` / `]` the film's bleep level; `Shift+D` re-refine the parts marked Redo; `?` keymap (it lists the timing
  handles' keys too); `Esc` drops an unsaved timing change, else closes. An effect
  key or button applies the effect through `PUT /:rk/cues/:id` / `/scenes/:id`
  (`content_filter.review.effect`), refreshes the player's filter and replays the part with the new
  effect (`previewStore.refresh()` then `jumpToCue`; if the refresh is refused the message says so
  and nothing replays). It records **no verdict** and does not move the cursor: the part waits for
  `A` ("Mute applied. Watch it, then press A to approve."). While the `?` sheet is open only `?` and `Esc` act.
- **Cursor and scope.** Moving the cursor seeks 4 s before the part and plays. One scope drives the
  list, the timeline and stepping: the rail tab (`stage`) × To do only × order. A part that plays is never
  "open" except on the Plays tab. Stepping does not wrap ("That is the last part in this view.").
- **Auto-advance.** A saved verdict moves to the next open part in the scope; at the end: "All N in
  this view reviewed", or "End of this view. N still open above."
- **Verdict semantics.** `approve` = fine as it is; `ignore` = no opinion and counts as done; `remove`
  disables the cue or scene (a false positive; it is terminal once the re-audit lands, because the row
  leaves the audit); `redo` = rework, with an optional reason. Undo (`U`, or `DELETE`) drops the verdict
  and reverts what it applied, including merged in-place changes (the effect or edges go back to `from`,
  a removed row is re-enabled; re-verdicting over a `remove` also re-enables and re-audits). A verdict whose row's span later moves is dropped and the row returns to
  unreviewed.
- **Permalinks.** Every filter has one: `/admin/content/filter/<ratingKey>/<rowId>` selects and seeks
  that row (an unknown id says "That filter isn't in this film any more"); selecting a row updates the
  URL in place.
- **Timeline.** Under the player, a review timeline shows the parts in the current scope with the
  cursor (playing parts grey); clicking one seeks to it.
- **Rework.** `Shift+D` (press once to arm, again within 4 s to send; the ⋯ menu item is one step; at most 500 reasons) queues one run for only the rows flagged redo: a send-back of their cues, or the
  scenes stage when only scene rows are flagged (scene rows stay flagged when mixed with cues). Each
  row's redo reason is stored on the run.
- **Draft preview.** Every unsaved span in the strip (the part's and its neighbours') goes to the
  preview store (`setDrafts`) and the player applies it, so Filtered plays what was dragged or
  marked while it autosaves; the save refreshes the player, Esc drops a draft not yet saved.
- **Bleep volume panel.** The header's **Bleep n %** button opens one panel for both levels:
  **Household** (the `bleepLevel` every film follows, `PUT /profiles/family/settings`) and **This
  film** (its own level, or "Follows household", with **Follow household** to drop it), each with
  − / + in 5 % steps (no sliders), plus **Test bleep**, which sounds at the level in force. The
  household stepper shows each click at once and writes in click order through the same serialised
  queue as the film level; a write whose session changed is not sent and is not logged as saved.
  Every button has a tooltip naming what it does.
- **Bleep level.** The bleep tone volume, effective = film setting, else household profile `bleepLevel`,
  else 0.25 (clamped 0 to 1). `[` / `]` change the film's level by 0.05; a debounced write saves it to
  the film's settings. After the player accepts the refreshed profile, Review replays the cue if it
  is still selected. If the preview read fails, Review keeps the saved level visible and offers
  Retry preview. Press Enter from the review station or activate the button to reread the preview
  without saving the setting again. The level applies at playback.
- **Bleep level for one cue.** A single bleeped cue can have its own level, over the film's and the
  household's: effective = cue `cueOverrides.<id>.bleepLevel`, else film, else household, else 0.25.
  The card's effect menu and the part menu offer "Bleep volume for this cue…" (− / + in 0.05 steps,
  "Follow film" clears it) for a single bleeped cue, and also for a single cue that still holds a
  level after its effect changed, so the level can be cleared; each step is `PUT /:rk/cues/:id { bleepLevel }` (0..1 clamped, null
  removes), saved in order. The review read carries it as `row.bleepLevel` (null = follows the film).
  Like the film level it is loudness only: it starts no audit and is left out of the filter digest,
  so the check never goes stale over it. `resolveEffectiveCues` puts it on the effective cue and the
  bleep handler passes it to the tone as `level`; when two bleeps merge into one tone it sounds at the
  louder of their levels; a named sound plays at the set's volume as before.

**Review video quality.** The review player requests the film at 360p / 1000 kbps (`REVIEW_QUALITY` in `ReviewPlayer.jsx`; the standard `maxResolution` / `maxVideoBitrate` playback-quality caps, see `__docs/reference/player/playback-quality.md`), so seeks and jumps land fast. Raise it for a closer look at a picture effect.
