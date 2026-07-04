/**
 * CaptureCard — the recording UI over the capture engine (Task 6.2, design §5/§7).
 *
 * Renders as a prominent overlay CARD above the stage — deliberately NOT
 * full-screen: you record BY playing, so the keyboard band must stay visible
 * and playable, and the transport bar stays too (this is a performance
 * surface). Design's "capture card drops over any view" is honored as a card
 * with the stage content dimmed behind it.
 *
 * FLOW
 *   setup  → loop length (2/4/8 bars, or "match jam" when layers exist —
 *            current cycle bars from transport.lengthMs / barMs), drum-mode
 *            toggle (neutral default OFF — auto-suggesting ON for empty
 *            workspaces was considered and rejected: a blank page is just as
 *            often a chord bed as a groove), count-in chips (1/2 bars).
 *   Arm    → two anchor paths, both performance.now()-domain (the engine's
 *            clock-domain prescription — see useLoopCapture's header):
 *     · jam playing: capture anchors to the next PHASE-ALIGNED bar boundary —
 *       the first global bar ≡ 0 (mod lengthBars), derived from
 *       positionRef.{bar,normalized} × lengthMs → barMs remainder. Plain
 *       next-bar anchoring would rotate the kept take on playback (the
 *       transport re-enters cycles at globalBar % bars) — DAW punch-at-loop-
 *       top instead; the wait shows as −N on the dial. Count-in is IGNORED on
 *       this path — the jam IS the click. positionRef is rAF-fresh (≤1 frame
 *       stale); the engine's 100ms early-hit grace absorbs that.
 *     · not playing (or the transport is still mid-count-in, pos.bar < 0):
 *       transport.play() with the workspace countInBars + metronome forced ON
 *       for the session (restored on close). The anchor is the transport's
 *       content-start instant, derived INDEPENDENTLY as performance.now() +
 *       countInBars×barMs — the transport computes the same sum internally µs
 *       later, so OUR anchor sits µs EARLY and hits read a hair LATE (µs-
 *       scale, musically moot). Note the 100ms grace window is for genuinely
 *       EARLY anticipatory hits — it is not what absorbs this skew. (The
 *       metronome-set → play() ordering race on the transport's
 *       render-assigned ref is harmless here: count-in clicks fire
 *       unconditionally, and the content-phase metronome check happens bars
 *       later, long after the forced state has rendered.)
 *   cycling → bar dial (−N during count-in, then "bar N of M"), pass counter,
 *            three big pass buttons (Undo pass / Clear / Keep — Undo and Keep
 *            disabled until passCount ≥ 1 per the engine prescription), snap
 *            toggle (off / 1/16), drum toggle + finger pads.
 *   Keep   → non-destructive keep() peek; a kind chip row appears
 *            (Groove/Chords/Melody, inferred one highlighted, one tap to
 *            override) + Confirm → onKeep(take) → workspace layer. The kind
 *            chip shows only on the Keep-confirm step (a per-frame keep()
 *            "preview" was rejected — keep() flattens + analyzes the take).
 *            Confirm also clearTake()s: the kept notes now loop audibly as a
 *            workspace layer, and leaving them in the capture buffer would
 *            double-add on the next Keep. Capture stays armed and cycling —
 *            keep-and-continue; Done closes.
 *
 * MIDI: subscribes while armed; RE-STAMPS every event with performance.now()
 * (evt.time is Date.now-domain — see the engine's integration prescription).
 * In drum mode the mapped GM drum note is ALSO forwarded to the router on
 * ch 9 so the player hears the drums they're playing. HONEST LIMITATION: on
 * physical keys the piano's own (local) sound still plays too — piano+drum
 * together — unless local control is off (a separate CC122 concern, out of
 * scope here). The on-screen finger pads give pure drum sound.
 *
 * @param {object} props
 * @param {number} props.bpm                      workspace bpm (engine snapshots at arm)
 * @param {[number,number]} [props.timeSig=[4,4]]
 * @param {object} props.transport                useProducerTransport surface
 * @param {object} props.router                   voiceRouter (drum-pad monitoring, ch 9)
 * @param {(fn:Function) => Function} props.subscribeMidi  usePianoMidi().subscribe
 * @param {boolean} props.metronome                current workspace metronome state
 * @param {(on:boolean) => void} props.onSetMetronome
 * @param {number} props.countInBars              workspace-held count-in (1|2)
 * @param {(n:number) => void} props.onCountInBars
 * @param {boolean} props.hasLayers               offers "match jam" length when true
 * @param {(take:object) => void} props.onKeep    confirmed take (kind possibly overridden)
 * @param {() => void} props.onClose
 * @param {() => void} [props.onAudioGesture]     ensureAudio (arm tap unlocks the synth)
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import getLogger from '../../../../lib/logging/Logger.js';
import { useLoopCapture, DRUM_KEY_MAP, PPQ } from './useLoopCapture.js';
import { DRUM_CHANNEL } from './workspaceReducer.js';
import { LoopRoll } from './LoopRoll.jsx';
import './CaptureCard.scss';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-producer-capture-ui' });
  return _logger;
}
const SAMPLE_OPTS = { maxPerMinute: 20, aggregate: true };

/** Dial refresh gate: ≤8Hz React state writes from the rAF loop. */
const DIAL_MS = 125;
/** On-screen finger-pad velocity (no pressure on a touchscreen). */
const PAD_VELOCITY = 100;

const LENGTH_CHOICES = [2, 4, 8];
const COUNT_IN_CHOICES = [1, 2];
const KIND_CHOICES = ['groove', 'chords', 'melody'];

/** Pad row, engine-key order — labels for the DRUM_KEY_MAP octave (design §5). */
const PADS = [
  { key: 36, label: 'Kick' },
  { key: 38, label: 'Snare' },
  { key: 40, label: 'Hat' },
  { key: 41, label: 'Open Hat' },
  { key: 43, label: 'Tom Lo' },
  { key: 45, label: 'Tom Mid' },
  { key: 47, label: 'Tom Hi' },
  { key: 48, label: 'Crash' },
  { key: 50, label: 'Ride' },
];

const sanitizeTimeSig = (ts) => {
  const [beats, beatType] = Array.isArray(ts) ? ts : [];
  const ok = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
  return [ok(beats) ? beats : 4, ok(beatType) ? beatType : 4];
};

export function CaptureCard({
  bpm,
  timeSig = [4, 4],
  transport,
  router,
  subscribeMidi,
  metronome,
  onSetMetronome,
  countInBars,
  onCountInBars,
  hasLayers,
  onKeep,
  onClose,
  onAudioGesture,
}) {
  const capture = useLoopCapture({ bpm, timeSig });
  const captureRef = useRef(capture); captureRef.current = capture;
  const routerRef = useRef(router); routerRef.current = router;

  const [beats, beatType] = sanitizeTimeSig(timeSig);
  const safeBpm = typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
  const barMs = (60000 / safeBpm) * (4 / beatType) * beats;

  // "Match jam": the current cycle's bar count, from the transport's stack
  // cycle length. Offered (and defaulted) only when layers exist.
  const jamBars = hasLayers && transport.lengthMs > 0
    ? Math.max(1, Math.round(transport.lengthMs / barMs))
    : null;

  const [lengthBars, setLengthBars] = useState(jamBars ?? 4);
  const [matchJam, setMatchJam] = useState(jamBars != null);
  const [snap, setSnap] = useState('off'); // 'off' | 'sixteenth'
  /** null until Keep is tapped; then { take, kind } awaiting confirm. */
  const [pending, setPending] = useState(null);
  /** { phase:'countin', bar } | { phase:'cycling', bar, of } */
  const [dial, setDial] = useState(null);

  const armed = capture.state !== 'idle';
  const drumMode = capture.drumMode;
  const drumModeRef = useRef(drumMode); drumModeRef.current = drumMode;

  /** Armed geometry for the dial (UI-side mirror of the engine snapshot). */
  const geomRef = useRef(null);
  /** true when WE turned the metronome on for this session (restore on close). */
  const forcedMetroRef = useRef(false);
  /** true when THIS session started the transport (metronome path) — if the
   * workspace is still empty at close, the transport would be left "playing"
   * a silent empty cycle; we stop it (see the unmount cleanup). */
  const startedTransportRef = useRef(false);
  const armPathRef = useRef(null); // 'jam' | 'metronome' (logging)
  const onSetMetronomeRef = useRef(onSetMetronome); onSetMetronomeRef.current = onSetMetronome;
  const transportRef = useRef(transport); transportRef.current = transport;
  const hasLayersRef = useRef(hasLayers); hasLayersRef.current = hasLayers;
  /** Sounding drum monitors: original key → mapped GM note. Kept OUTSIDE the
   * drum-mode gate so a note-off after a mode flip still silences ch 9. */
  const soundingDrumsRef = useRef(new Map());

  useEffect(() => {
    logger().info('capture-ui.open', { hasLayers: !!hasLayers, jamBars });
    return () => logger().info('capture-ui.close', {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── arm: the two anchor paths (see header) ──────────────────────────────────
  const handleArm = useCallback(() => {
    onAudioGesture?.();
    const now = performance.now(); // PRESCRIPTION (a): monotonic anchor, never Date.now
    let anchorWallMs;
    let ci;
    const pos = transport.positionRef?.current;
    // Jam path only once CONTENT is rolling. During a transport count-in
    // (pos.bar < 0) normalized is 0 and the bar is negative — the next-bar
    // math would mint a garbage anchor and real notes would drop as
    // count-in. Route to the metronome branch instead: play() is
    // restart-safe (releases sounding notes, restarts with a fresh count-in).
    if (transport.isPlaying && transport.lengthMs > 0 && (pos?.bar ?? 0) >= 0) {
      // Jam playing: count-in ignored — the jam IS the click. Anchor at the
      // next bar boundary WHOSE GLOBAL BAR ≡ 0 (mod lengthBars): playback
      // re-enters a cycle at globalBar % bars (useProducerTransport's
      // phase-match), so tick 0 must land on such a bar or the kept take
      // plays back ROTATED relative to what was performed (a chord take
      // recorded from mid-cycle would sit under the wrong chords). This is
      // the DAW punch-at-loop-top rule; the dial shows the wait as −N bars.
      const posMs = (pos?.normalized ?? 0) * transport.lengthMs;
      const toNextBar = barMs - (posMs % barMs);
      const nextBar = (pos?.bar ?? 0) + 1;
      const barsToWait = ((lengthBars - (nextBar % lengthBars)) % lengthBars + lengthBars) % lengthBars;
      anchorWallMs = now + toNextBar + barsToWait * barMs;
      ci = 0;
      armPathRef.current = 'jam';
    } else {
      // Silence: the transport provides the click. Force the metronome for
      // the session (restored on close) and start with the count-in; the
      // content-start instant is now + ci×barMs on BOTH sides of the seam.
      if (!metronome) {
        forcedMetroRef.current = true;
        onSetMetronome(true);
      }
      ci = countInBars;
      anchorWallMs = now + ci * barMs;
      startedTransportRef.current = true; // we own this playback (see close)
      transport.play();
      armPathRef.current = 'metronome';
    }
    geomRef.current = { anchorMs: anchorWallMs, barMs, lengthBars };
    capture.arm({ lengthBars, anchorWallMs, countInBars: ci });
    // Initial dial from the ANCHOR (not ci): the jam path can also wait bars
    // (phase alignment above), and that wait reads as a count-in.
    const barsOut = Math.ceil((anchorWallMs - now) / barMs);
    setDial(barsOut >= 1 ? { phase: 'countin', bar: barsOut } : { phase: 'cycling', bar: 1, of: lengthBars });
    logger().info('capture-ui.arm', {
      lengthBars, countInBars: ci, drumMode: drumModeRef.current,
      path: armPathRef.current, snap,
    });
  }, [transport, barMs, lengthBars, countInBars, metronome, onSetMetronome, capture, snap, onAudioGesture]);

  // ── rAF loop while armed: engine tick + dial (≤8Hz state) ──────────────────
  useEffect(() => {
    if (!armed) return undefined;
    let raf = 0;
    let lastDial = 0;
    const loop = () => {
      // PRESCRIPTION (c): read performance.now() ourselves — never mix the
      // rAF timestamp argument into anchor math.
      const now = performance.now();
      captureRef.current.tick(now);
      if (now - lastDial >= DIAL_MS) {
        lastDial = now;
        const g = geomRef.current;
        if (g) {
          if (now < g.anchorMs) {
            const bar = Math.ceil((g.anchorMs - now) / g.barMs);
            setDial((d) => (d?.phase === 'countin' && d.bar === bar ? d : { phase: 'countin', bar }));
          } else {
            const bar = (Math.floor((now - g.anchorMs) / g.barMs) % g.lengthBars) + 1;
            setDial((d) => (d?.phase === 'cycling' && d.bar === bar ? d : { phase: 'cycling', bar, of: g.lengthBars }));
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [armed]);

  // ── MIDI feed while armed: RE-STAMP with performance.now() (prescription b) ─
  useEffect(() => {
    if (!armed || !subscribeMidi) return undefined;
    const unsub = subscribeMidi((evt) => {
      const wallMs = performance.now(); // IGNORE evt.time — Date.now domain
      if (evt.type === 'note_on') {
        captureRef.current.noteOn(evt.note, evt.velocity, wallMs);
        if (drumModeRef.current) {
          const mapped = DRUM_KEY_MAP[evt.note];
          if (mapped !== undefined) {
            // Hear the drums you're playing. (Physical keys also sound the
            // piano locally — documented limitation, see header.)
            soundingDrumsRef.current.set(evt.note, mapped);
            routerRef.current?.noteOn(DRUM_CHANNEL, mapped, evt.velocity);
          }
        }
      } else if (evt.type === 'note_off') {
        captureRef.current.noteOff(evt.note, wallMs);
        const mapped = soundingDrumsRef.current.get(evt.note);
        if (mapped !== undefined) {
          soundingDrumsRef.current.delete(evt.note);
          routerRef.current?.noteOff(DRUM_CHANNEL, mapped);
        }
      }
    });
    return unsub;
  }, [armed, subscribeMidi]);

  // Pass milestones (sampled — a long session rolls many).
  const lastPassRef = useRef(0);
  useEffect(() => {
    if (capture.passCount > lastPassRef.current) {
      logger().sampled('capture-ui.pass', { pass: capture.passCount, takeNotes: capture.takeNoteCount }, SAMPLE_OPTS);
    }
    lastPassRef.current = capture.passCount;
  }, [capture.passCount, capture.takeNoteCount]);

  // ── close/unmount: silence pads, restore metronome. The transport keeps
  // playing (the jam outlives the session) EXCEPT when this session started
  // it and nothing was kept — then it's a silent empty cycle, stop it. ──────
  useEffect(() => () => {
    for (const mapped of soundingDrumsRef.current.values()) {
      routerRef.current?.noteOff(DRUM_CHANNEL, mapped);
    }
    soundingDrumsRef.current.clear();
    if (forcedMetroRef.current) onSetMetronomeRef.current?.(false);
    if (startedTransportRef.current && !hasLayersRef.current) {
      logger().info('capture-ui.stop-orphan-transport', {});
      transportRef.current?.stop();
    }
  }, []);

  const handleClose = useCallback(() => {
    capture.disarm(); // unmount tears the engine down anyway; disarm keeps logs honest
    onClose();
  }, [capture, onClose]);

  // ── pass buttons / keep flow ────────────────────────────────────────────────
  const canPass = capture.passCount >= 1;

  const handleKeepTap = useCallback(() => {
    const take = capture.keep({ snap });
    setPending({ take, kind: take.kind });
  }, [capture, snap]);

  const handleConfirmKeep = useCallback(() => {
    if (!pending) return;
    const take = { ...pending.take, kind: pending.kind };
    logger().info('capture-ui.keep', {
      takeId: take.takeId, kind: take.kind, inferredKind: pending.take.kind,
      notes: take.notes.length, snap, lengthBars: take.lengthBars,
    });
    onKeep(take);
    // The take now loops as a workspace layer — clear the buffer so the next
    // Keep can't double-add it. Cycling continues (keep-and-continue).
    capture.clearTake();
    setPending(null);
  }, [pending, onKeep, capture, snap]);

  // ── drum pads (pointer, ≥48px targets) ──────────────────────────────────────
  const handlePadDown = useCallback((key) => {
    onAudioGesture?.();
    const mapped = DRUM_KEY_MAP[key];
    if (mapped === undefined) return;
    soundingDrumsRef.current.set(key, mapped);
    routerRef.current?.noteOn(DRUM_CHANNEL, mapped, PAD_VELOCITY);
    captureRef.current.noteOn(key, PAD_VELOCITY, performance.now());
  }, [onAudioGesture]);

  const handlePadUp = useCallback((key) => {
    const mapped = soundingDrumsRef.current.get(key);
    if (mapped === undefined) return;
    soundingDrumsRef.current.delete(key);
    routerRef.current?.noteOff(DRUM_CHANNEL, mapped);
    captureRef.current.noteOff(key, performance.now());
  }, []);

  const drumToggle = (
    <button
      type="button"
      className={`piano-chip piano-capture-card__drum-toggle${drumMode ? ' is-on' : ''}`}
      aria-pressed={drumMode}
      onClick={() => {
        logger().info('capture-ui.drum-mode', { on: !drumMode });
        capture.setDrumMode(!drumMode);
      }}
    >Drums</button>
  );

  return (
    <div className="piano-capture-card__scrim">
      <div className="piano-capture-card" role="dialog" aria-label="capture">
        <div className="piano-capture-card__top">
          <h3 className="piano-capture-card__title">
            {armed ? 'Recording — loop rolling' : 'Record a loop'}
          </h3>
          <button
            type="button"
            className="piano-capture-card__close"
            aria-label="close capture"
            onClick={handleClose}
          >✕</button>
        </div>

        {!armed && (
          <div className="piano-capture-card__setup">
            <div className="piano-capture-card__row" role="group" aria-label="loop length">
              <span className="piano-capture-card__label">Length</span>
              {jamBars != null && (
                <button
                  type="button"
                  className={`piano-chip${matchJam ? ' is-on' : ''}`}
                  onClick={() => { setMatchJam(true); setLengthBars(jamBars); }}
                >Match jam · {jamBars}</button>
              )}
              {LENGTH_CHOICES.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`piano-chip${!matchJam && lengthBars === n ? ' is-on' : ''}`}
                  onClick={() => { setMatchJam(false); setLengthBars(n); }}
                >{n} bars</button>
              ))}
            </div>

            <div className="piano-capture-card__row" role="group" aria-label="count-in">
              <span className="piano-capture-card__label">Count-in</span>
              {COUNT_IN_CHOICES.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`piano-chip${countInBars === n ? ' is-on' : ''}`}
                  disabled={transport.isPlaying}
                  onClick={() => onCountInBars(n)}
                >{n} bar{n > 1 ? 's' : ''}</button>
              ))}
              {transport.isPlaying && (
                <span className="piano-capture-card__hint">jam plays you in</span>
              )}
            </div>

            <div className="piano-capture-card__row">
              <span className="piano-capture-card__label">Mode</span>
              {drumToggle}
            </div>

            <button type="button" className="piano-capture-card__arm" onClick={handleArm}>
              ● Arm
            </button>
          </div>
        )}

        {armed && (
          <div className="piano-capture-card__live">
            {/* Live piano-roll (design §8): your playing appears here each loop
                and thickens, so you SEE the take building — not just a counter. */}
            {capture.takeNotes.length > 0 ? (
              <LoopRoll
                notes={capture.takeNotes}
                ppq={PPQ}
                barSpan={capture.lengthBars || lengthBars}
                positionRef={transport?.positionRef}
                isPlaying
              />
            ) : (
              <div className="piano-capture-card__roll-empty" role="status">
                Play along — your notes land here
              </div>
            )}

            <div className="piano-capture-card__dial-row">
              <span
                className={`piano-capture-card__dial${dial?.phase === 'countin' ? ' is-countin' : ''}`}
                aria-label="bar dial"
              >
                {dial?.phase === 'countin' ? `−${dial.bar}` : `${dial?.bar ?? 1} / ${dial?.of ?? lengthBars}`}
              </span>
              <span className="piano-capture-card__passes" aria-label="passes">
                {capture.passCount} pass{capture.passCount === 1 ? '' : 'es'}
                {capture.takeNoteCount > 0 ? ` · ${capture.takeNoteCount} notes` : ''}
              </span>
            </div>

            <div className="piano-capture-card__pass-buttons">
              <button
                type="button"
                className="piano-capture-card__pass-btn"
                disabled={!canPass}
                onClick={() => { setPending(null); capture.undoPass(); }}
              >Undo pass</button>
              <button
                type="button"
                className="piano-capture-card__pass-btn"
                onClick={() => { setPending(null); capture.clearTake(); }}
              >Clear</button>
              <button
                type="button"
                className="piano-capture-card__pass-btn piano-capture-card__pass-btn--keep"
                disabled={!canPass}
                onClick={handleKeepTap}
              >Keep</button>
            </div>

            {pending && (
              <div className="piano-capture-card__confirm" role="group" aria-label="confirm kind">
                {KIND_CHOICES.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`piano-chip${pending.kind === k ? ' is-on' : ''}`}
                    onClick={() => setPending((p) => ({ ...p, kind: k }))}
                  >{k[0].toUpperCase() + k.slice(1)}</button>
                ))}
                <button
                  type="button"
                  className="piano-capture-card__confirm-btn"
                  onClick={handleConfirmKeep}
                >Confirm</button>
              </div>
            )}

            <div className="piano-capture-card__row">
              <button
                type="button"
                className={`piano-chip${snap === 'sixteenth' ? ' is-on' : ''}`}
                aria-pressed={snap === 'sixteenth'}
                onClick={() => setSnap((s) => (s === 'sixteenth' ? 'off' : 'sixteenth'))}
              >Snap 1/16</button>
              {drumToggle}
              <button type="button" className="piano-capture-card__done" onClick={handleClose}>
                Done
              </button>
            </div>
          </div>
        )}

        {drumMode && (
          <div className="piano-capture-card__pads" role="group" aria-label="drum pads">
            {PADS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className="piano-capture-card__pad"
                onPointerDown={() => handlePadDown(key)}
                onPointerUp={() => handlePadUp(key)}
                onPointerLeave={() => handlePadUp(key)}
                onPointerCancel={() => handlePadUp(key)}
              >{label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default CaptureCard;
