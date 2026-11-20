import { useCallback, useEffect, useRef, useState } from 'react';
import { SchoolButton } from '../../portal/SchoolButton.jsx';
import Icon from '../../home/icons/Icon.jsx';
import ProfileAvatar from '../../../../../../frontend/src/lib/identity/ProfileAvatar.jsx';
import VoiceBand from '../SentenceLadder/rungs/VoiceBand.jsx';
import useTakeRecorder from '../shared/useTakeRecorder.js';
import { DEBRIEF_FLOOR, createVoiceMeter, meterLevel } from '../shared/speechFloor.js';
import { speak } from '../shared/useProgramKeys.js';
import { playScanCeremonyTone } from '../../selfService/scanCeremonySound.js';
import { PRESCHOOL_HINTS, hintFor, unusedHints, steerLine } from './preschoolHints.js';
import { gratitudeLog } from './gratitudeLog.js';
import './PreschoolGratitude.scss';

export const PRESCHOOL_LINES = Object.freeze({
  ask: 'What made you happy today?',
  unheard: "I didn't hear you. Try again.",
  yellow: 'That sounded silly. Tell me one real thing you liked today.',
  red: "Let's take a break and try again soon.",
});
const RING_RADIUS = 45;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** Which full-screen state a preschooler sees. One big action each. */
export function preschoolScreen({ phase, busy, listening, hearing, heard }) {
  if (phase === 'completed') return 'green';
  if (phase === 'cooldown') return 'red';
  if (busy || hearing || ['pending', 'assessing'].includes(phase)) return 'checking';
  if (listening) return 'listening';
  if (heard) return 'confirm';
  if (phase === 'steered') return 'blue';
  if (phase === 'warned') return 'yellow';
  return 'ask';
}

/**
 * Gratitude for a preschooler: no text box, no keyboard. Ask → Listening →
 * "Did you say…?" → Checking → a green, blue, yellow or red result.
 * The server owns every verdict; this screen only speaks and shows it.
 */
export default function PreschoolGratitude({ view, learnerId, learnerName = null, busy = false, remaining = 0, onTake, onSubmit, onRetry, onClose }) {
  const [heard, setHeard] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState(null);
  const [level, setLevel] = useState(0);
  const meter = useRef(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const receive = useCallback(async ({ blob }) => {
    setUploading(true);
    try {
      const result = await onTake(blob);
      if (!live.current) return;
      // Takes never pile up: each one is the whole answer, confirmed or thrown away.
      if (result?.unheard || !result?.text) { setNotice(PRESCHOOL_LINES.unheard); setHeard(null); }
      else setHeard({ text: result.text, audioRef: result.audioRef ?? null });
    } catch {
      if (live.current) setNotice(PRESCHOOL_LINES.unheard);
    } finally { if (live.current) setUploading(false); }
  }, [onTake]);
  const recorder = useTakeRecorder({ floor: DEBRIEF_FLOOR, onTake: receive });
  const listening = recorder.phase === 'recording';
  const hearing = recorder.phase === 'saving' || uploading;
  const screen = preschoolScreen({ phase: view.phase, busy, listening, hearing, heard });

  useEffect(() => { if (recorder.verdict) setNotice(PRESCHOOL_LINES.unheard); }, [recorder.verdict]);
  useEffect(() => { gratitudeLog.screen({ screen }); }, [screen]);

  // Each screen says its line once when it appears (and again for a new verdict).
  const subject = view.subject ?? '';
  useEffect(() => {
    if (screen === 'ask') speak(notice ?? PRESCHOOL_LINES.ask);
    else if (screen === 'confirm') speak(`Did you say: ${heard?.text}?`);
    else if (screen === 'green') { playScanCeremonyTone('success'); speak(`Thank you! I'll remember: ${subject.toLowerCase()}.`); }
    else if (screen === 'blue') speak(notice ?? steerLine(view.steer));
    else if (screen === 'yellow') speak(notice ?? PRESCHOOL_LINES.yellow);
    else if (screen === 'red') speak(PRESCHOOL_LINES.red);
  }, [screen, view.attemptId, notice]); // eslint-disable-line react-hooks/exhaustive-deps

  const listen = () => {
    if (busy || hearing) return;
    if (listening) { recorder.stop(); return; }
    setNotice(null); setHeard(null);
    meter.current = createVoiceMeter(performance.now());
    recorder.start();
  };
  const onLevel = useCallback((value) => {
    recorder.onLevel?.(value);
    setLevel(value);
    // Stops by itself after the child goes quiet (the shared speech floor).
    if (meter.current && meterLevel(meter.current, value, performance.now()) === 'auto-stop') recorder.stop();
  }, [recorder]);
  const yes = () => { if (!heard || busy) return; const answer = heard; setHeard(null); onSubmit({ text: answer.text, via: 'voice', audioRef: answer.audioRef, edited: false }); };
  const again = () => { setHeard(null); listen(); };

  const name = learnerName ?? learnerId;
  const mic = (label = 'Tell me') => (
    <SchoolButton variant="plain" type="button" className="preschool-gratitude__mic" aria-label={label} disabled={busy || hearing || recorder.unavailable} onClick={listen}>
      <Icon name="microphone" />
    </SchoolButton>
  );
  const hints = (list) => (
    <div className="preschool-gratitude__hints">
      {list.map((hint) => (
        <SchoolButton key={hint.id} variant="plain" type="button" className="preschool-gratitude__hint" aria-label={hint.label} onClick={() => speak(hint.example)}>
          <Icon name={hint.icon} /><span>{hint.label}</span>
        </SchoolButton>
      ))}
    </div>
  );

  let body;
  if (screen === 'ask') body = <>
    <Icon name="heart" className="preschool-gratitude__picture" />
    <h2>{PRESCHOOL_LINES.ask}</h2>
    {notice && <p className="preschool-gratitude__notice" role="status">{notice}</p>}
    {recorder.unavailable && <p className="preschool-gratitude__notice" role="status">The microphone is not working. Ask a grown-up.</p>}
    {hints(PRESCHOOL_HINTS)}
    {mic()}
  </>;
  else if (screen === 'listening') body = <>
    <h2>I'm listening…</h2>
    <SchoolButton variant="plain" type="button" className="preschool-gratitude__mic preschool-gratitude__mic--live" aria-label="Done" onClick={listen} style={{ '--preschool-level': String(Math.min(1, level * 3)) }}>
      <Icon name="microphone" />
    </SchoolButton>
    <VoiceBand stream={recorder.stream} onLevel={onLevel} />
  </>;
  else if (screen === 'confirm') body = <>
    <h2>Did you say…</h2>
    <p className="preschool-gratitude__said">“{heard.text}”</p>
    <div className="preschool-gratitude__choices">
      <SchoolButton variant="plain" type="button" className="preschool-gratitude__choice preschool-gratitude__choice--yes" onClick={yes}><Icon name="check" /><span>Yes</span></SchoolButton>
      <SchoolButton variant="plain" type="button" className="preschool-gratitude__choice preschool-gratitude__choice--again" onClick={again}><Icon name="restart" /><span>Say it again</span></SchoolButton>
    </div>
  </>;
  else if (screen === 'checking') body = <>
    <svg className="preschool-gratitude__spinner" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r={RING_RADIUS} pathLength="100" strokeDasharray="70 30">
        <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="1.2s" repeatCount="indefinite" />
      </circle>
    </svg>
    <h2 role="status">{hearing ? 'Listening back…' : 'Checking…'}</h2>
    {!busy && !hearing && view.phase === 'pending' && <SchoolButton variant="plain" type="button" className="preschool-gratitude__choice" onClick={onRetry}><Icon name="restart" /><span>Try again</span></SchoolButton>}
  </>;
  else if (screen === 'green') {
    const hint = hintFor(subject);
    body = <>
      <Icon name="check" className="preschool-gratitude__picture" />
      <h2>Thank you!</h2>
      <p className="preschool-gratitude__subject"><Icon name={hint?.icon ?? 'heart'} /><span>{subject}</span></p>
    </>;
  } else if (screen === 'blue') {
    const used = view.steer?.used ?? null;
    body = <>
      <Icon name="idea" className="preschool-gratitude__picture" />
      <h2>Try something new</h2>
      {used && <p className="preschool-gratitude__used"><span>{used.subject}</span><small>already used</small></p>}
      {hints(unusedHints([...(view.steer?.recent ?? []), ...(used ? [used.subject] : [])]))}
      {mic('Try again')}
    </>;
  } else if (screen === 'yellow') body = <>
    <Icon name="warning" className="preschool-gratitude__picture" />
    <h2>That was silly</h2>
    <p>Tell me one real thing you liked today.</p>
    {mic('Try again')}
  </>;
  else {
    const total = view.cooldownMs > 0 ? view.cooldownMs : Math.max(remaining, 1);
    const left = Math.max(0, Math.min(1, remaining / total));
    const minutes = Math.max(1, Math.ceil(remaining / 60_000));
    body = <>
      <svg className="preschool-gratitude__ring" viewBox="0 0 100 100" role="img" aria-label={`${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left`}>
        <circle className="preschool-gratitude__ring-track" cx="50" cy="50" r={RING_RADIUS} />
        <circle className="preschool-gratitude__ring-left" cx="50" cy="50" r={RING_RADIUS} strokeDasharray={RING_LENGTH} strokeDashoffset={RING_LENGTH * (1 - left)} data-left={left.toFixed(3)} />
      </svg>
      <Icon name="hourglass" className="preschool-gratitude__picture" />
      <h2>Let's take a break</h2>
      <p>Try again soon.</p>
    </>;
  }

  return <section className={`preschool-gratitude preschool-gratitude--${screen}`} data-screen={screen}>
    <header className="preschool-gratitude__header">
      <span className="preschool-gratitude__learner"><ProfileAvatar id={learnerId} name={name} size={256} /><span>{name}</span></span>
      <SchoolButton variant="plain" type="button" className="preschool-gratitude__close" aria-label="Close" onClick={onClose}><Icon name="close" /></SchoolButton>
    </header>
    <div className="preschool-gratitude__body">{body}</div>
  </section>;
}
