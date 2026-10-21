import { useCallback, useEffect, useRef, useState } from 'react';
import { TouchButton } from "../../../../../../../frontend/src/lib/ui/index.js";
import Icon from "../../../home/icons/Icon.jsx";
import VoiceBand from "../../SentenceLadder/rungs/VoiceBand.jsx";
import useTakeRecorder from "../../shared/useTakeRecorder.js";
import { useSchoolDebriefKeys, speak } from "../useSchoolDebriefKeys.js";
import { schoolDebriefLog } from "../schoolDebriefLog.js";

/**
 * One prompt (or the clarify question, or a short answer's field): type, or
 * Space to record → transcript lands in the field to correct → Enter submits.
 * Speaking is never required; with no mic API the record control is absent.
 */
export default function PromptItem({ prompt, initial = '', onSubmit, onBack = null, onTake, submitLabel = 'Next', busy: parentBusy = false }) {
  const [text, setText] = useState(initial);
  const [audioRef, setAudioRef] = useState(null);
  const [via, setVia] = useState(initial ? 'typed' : null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const field = useRef(null);
  useEffect(() => { setText(initial); setAudioRef(null); setVia(initial ? 'typed' : null); setNotice(null); }, [prompt.id, initial]);

  const recorder = useTakeRecorder({
    onTake: useCallback(async ({ blob }) => {
      setBusy(true);
      const res = await onTake(blob);
      setBusy(false);
      if (res?.audioRef) setAudioRef(res.audioRef);
      if (res?.text) { setText((t) => (t ? `${t} ${res.text}` : res.text)); setVia('voice'); schoolDebriefLog.takeKept({ promptId: prompt.id }); field.current?.focus(); }
      else setNotice("We saved your recording but couldn't read it — please type it too.");
    }, [onTake, prompt.id]),
  });
  // Keyed on the verdict alone: the recorder keeps its last verdict until the
  // next take starts, so depending on prompt.id too would repaint a refused
  // take's notice on every later prompt.
  const promptIdRef = useRef(prompt.id);
  promptIdRef.current = prompt.id;
  useEffect(() => {
    if (!recorder.verdict) return;
    schoolDebriefLog.takeRefused({ promptId: promptIdRef.current, verdict: recorder.verdict });
    setNotice(recorder.verdict === 'too-quiet' ? "We didn't hear that — speak up and try again." : 'That was too quick — say a bit more.');
  }, [recorder.verdict]);

  const recording = recorder.phase === 'recording';
  const canSubmit = !parentBusy && !busy && !recording && (!prompt.required || text.trim().length > 0);
  const submit = () => { if (canSubmit) { schoolDebriefLog.submit({ promptId: prompt.id, via: via ?? 'typed', chars: text.length }); onSubmit({ text: text.trim(), via: via ?? 'typed', audioRef }); } };
  const record = () => { setNotice(null); if (recording) recorder.stop(); else { schoolDebriefLog.takeStart({ promptId: prompt.id }); recorder.start(); } };

  useSchoolDebriefKeys({
    ...(recorder.unavailable ? {} : { ' ': () => { if (!text) record(); else if (recording) record(); } }),
    enter: submit,
    tab: () => speak(prompt.text),
    ...(onBack ? { arrowleft: onBack } : {}),
  });

  return (
    <section className="sd-item sd-prompt" aria-label="Tell me">
      <h2 className="sd-prompt__text">{prompt.text}</h2>
      <textarea
        ref={field} className="sd-prompt__field" value={text} rows={4} autoFocus aria-label={prompt.text}
        onChange={(e) => { setText(e.target.value); if (!via) setVia('typed'); }}
        onKeyDown={(e) => {
          if ((e.code === 'Space' || e.key === ' ') && !recorder.unavailable && (!text || recording)) { e.preventDefault(); record(); return; }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
        }}
      />
      {!recorder.unavailable && <VoiceBand stream={recording ? recorder.stream : null} onLevel={recording ? recorder.onLevel : null} />}
      {notice && <p className="sd-notice" role="status">{notice}</p>}
      <div className="sd-controls">
        {onBack && <TouchButton variant="secondary" keyHint="←" onClick={onBack}><Icon name="back" /> Back</TouchButton>}
        {!recorder.unavailable && (
          <TouchButton variant={recording ? 'primary' : 'secondary'} keyHint="Space" onClick={record} disabled={busy} aria-label={recording ? 'Stop recording' : 'Record'}>
            <Icon name={recording ? 'stop' : 'record'} /> {recording ? 'Stop' : 'Record'}
          </TouchButton>
        )}
        <TouchButton variant="primary" keyHint="Enter" onClick={submit} disabled={!canSubmit}><Icon name="next" /> {submitLabel}</TouchButton>
      </div>
    </section>
  );
}
