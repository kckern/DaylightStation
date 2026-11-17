import { useCallback, useEffect, useRef, useState } from 'react';
import { TouchButton } from '../../../../../../frontend/src/lib/ui/index.js';
import Icon from '../../home/icons/Icon.jsx';
import VoiceBand from '../SentenceLadder/rungs/VoiceBand.jsx';
import useTakeRecorder from './useTakeRecorder.js';
import { DEBRIEF_FLOOR } from './speechFloor.js';
import { useProgramKeys, speak } from './useProgramKeys.js';
import './ReflectionResponse.scss';

const NO_EVENTS = Object.freeze({});
export default function ReflectionResponse({ prompt, initial = '', initialAudioRef = null, initialVia = null, initialEdited = false, onSubmit, onDraft, onBack = null, onTake, onRetryTake, submitLabel = 'Next', busy: parentBusy = false, floor = DEBRIEF_FLOOR, events = NO_EVENTS, fieldSpaceStartsRecording = false, focusField = true }) {
  const [text, setText] = useState(initial);
  const [audioRef, setAudioRef] = useState(initialAudioRef);
  const [via, setVia] = useState(initialVia ?? (initial ? 'typed' : null));
  const [edited, setEdited] = useState(initialEdited);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failedBlob,setFailedBlob]=useState(null);
  // True once a transcript has filled the box, until the child records again.
  const [transcribed, setTranscribed] = useState(false);
  const field = useRef(null);
  const live = useRef(true);
  const pending = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { setText(initial); setAudioRef(initialAudioRef); setVia(initialVia ?? (initial ? 'typed' : null)); setEdited(initialEdited); setNotice(null); setTranscribed(false); }, [prompt.id, initial, initialAudioRef, initialVia, initialEdited]);
  const uploadTake = useCallback(async ({ blob, retrySaved = false }) => {
    pending.current = true; setBusy(true);
    events.transcribing?.({ promptId: prompt.id });
    try {
      const result = retrySaved ? await onRetryTake?.() : await onTake?.(blob);
      if (!live.current) return;
      if(!result?.audioRef)throw new Error('Recording was not confirmed');
      setFailedBlob(null);
      if (result?.audioRef) { setAudioRef(result.audioRef); setVia('voice'); }
      if (result?.text) { setText(t => t ? `${t} ${result.text}` : result.text); setTranscribed(true); events.takeKept?.({ promptId: prompt.id }); if (focusField) field.current?.focus(); }
      else setNotice(result?.audioRef ? 'Your recording is saved. Please type your answer or try recording again.' : "That recording didn't save. Please try again.");
    } catch { if (live.current) {setFailedBlob(blob??null);setNotice("We couldn't confirm your recording. Please try again.");} }
    finally { pending.current = false; if (live.current) setBusy(false); }
  }, [onTake, onRetryTake, events, prompt.id, focusField]);
  const recorder = useTakeRecorder({ floor, onTake: uploadTake });
  const promptRef = useRef(prompt.id); promptRef.current = prompt.id;
  useEffect(() => {
    if (!recorder.verdict) return;
    pending.current = false;
    events.takeRefused?.({ promptId: promptRef.current, verdict: recorder.verdict });
    setNotice(recorder.verdict === 'too-quiet' ? "We didn't hear that — speak up and try again." : 'That was too quick — say a bit more.');
  }, [recorder.verdict]);
  const recording = recorder.phase === 'recording';
  const capturing = recorder.phase === 'recording' || recorder.phase === 'saving';
  // Between Stop and the transcript the box can still be empty: say so (role=status).
  const transcribing = !recording && (recorder.phase === 'saving' || busy);
  const checkWords = transcribed && !notice && !capturing && !busy && text.trim().length > 0;
  const canSubmit = !parentBusy && !busy && !capturing && !pending.current && (!prompt.required || text.trim().length > 0);
  const submit = () => { if (canSubmit) { events.submit?.({ promptId: prompt.id, via: via ?? 'typed', chars: text.length }); onSubmit({ text: text.trim(), via: via ?? 'typed', audioRef, edited }); } };
  const record = () => { if (busy || parentBusy || recorder.phase === 'saving') return; setNotice(null); setTranscribed(false); if (recording) { pending.current = true; recorder.stop(); } else { events.takeStart?.({ promptId: prompt.id }); recorder.start(); } };
  useProgramKeys({ ...(recorder.unavailable ? {} : { ' ': () => { if (!text || recording) record(); } }), enter: submit, tab: () => speak(prompt.text), ...(onBack ? { arrowleft: onBack } : {}) });
  return <section className="reflection-response" aria-label="Tell me">
    <h2 className="reflection-response__prompt">{prompt.text}</h2>
    <textarea ref={field} className="reflection-response__field" value={text} rows={4} autoFocus={focusField} aria-label={prompt.text}
      onBlur={()=>{if(!capturing&&!busy)onDraft?.({text,via:via??'typed',audioRef,edited});}}
      onChange={e => { setText(e.target.value); if (via === 'voice') setEdited(true); else setVia('typed'); }}
      onKeyDown={e => {
        if (e.nativeEvent?.isComposing || e.isComposing || e.keyCode === 229) return;
        if ((e.code === 'Space' || e.key === ' ') && fieldSpaceStartsRecording && !recorder.unavailable && (!text || recording)) { e.preventDefault(); record(); return; }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
      }} />
    {!recorder.unavailable && <VoiceBand stream={recording ? recorder.stream : null} onLevel={recording ? recorder.onLevel : null} />}
    {recording && <p role="status">{recorder.heard ? 'I hear you' : 'Listening…'}</p>}
    {transcribing && <p className="reflection-response__status" role="status">Writing down what you said…</p>}
    {notice && <p className="reflection-response__notice" role="status">{notice}</p>}
    {checkWords && <p className="reflection-response__hint" role="status">{`Check your words, then tap ${submitLabel}.`}</p>}
    <div className="reflection-controls">
      {failedBlob&&<TouchButton variant="secondary" disabled={busy||capturing||parentBusy} onClick={()=>uploadTake({blob:failedBlob})}>Retry recording upload</TouchButton>}
      {!failedBlob&&initialAudioRef&&!text&&onRetryTake&&<TouchButton variant="secondary" disabled={busy||capturing||parentBusy} onClick={()=>uploadTake({retrySaved:true})}>Retry saved recording</TouchButton>}
      {onBack && <TouchButton variant="secondary" keyHint="←" onClick={onBack}><Icon name="back" /> Back</TouchButton>}
      {!recorder.unavailable && <TouchButton variant={recording ? 'primary' : 'secondary'} keyHint="Space" onClick={record} disabled={busy || parentBusy || recorder.phase === 'saving'} aria-label={recording ? 'Stop recording' : 'Record'}><Icon name={recording ? 'stop' : 'record'} /> {recording ? 'Stop' : 'Record'}</TouchButton>}
      <TouchButton variant="primary" keyHint="Enter" onClick={submit} disabled={!canSubmit}><Icon name="next" /> {submitLabel}</TouchButton>
    </div>
  </section>;
}
