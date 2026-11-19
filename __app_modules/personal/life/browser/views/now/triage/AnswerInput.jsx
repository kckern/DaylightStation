import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, TextInput, Text, Loader } from '@mantine/core';
import { IconMicrophone, IconPlayerStopFilled, IconArrowUp } from '@tabler/icons-react';
import { useMediaRecorderCapture } from "../../../../../../../frontend/src/modules/VoiceCapture/useMediaRecorderCapture.js";
import { DaylightAPI } from "../../../../../../../frontend/src/lib/api.mjs";
import getLogger from "../../../../../../../frontend/src/lib/logging/Logger.js";

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('blob read failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * The free-answer box: type, or tap the mic and speak. A transcript lands in the box for
 * the owner to confirm; it is never submitted on its own. `value` is owned by the caller so
 * a failed submit never loses the owner's words.
 */
export function AnswerInput({ value, onChange, onSubmit, placeholder = 'Or say what to do…', prompt = null, focusKey = null, disabled = false }) {
  const logger = useMemo(() => getLogger().child({ component: 'triage-answer-input' }), []);
  const { isRecording, start, stop, error: micError } = useMediaRecorderCapture();
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState(null);
  const inputRef = useRef(null);

  // Focus on request (e.g. "What's the smaller next step?"), once the box is enabled again.
  useEffect(() => {
    if (focusKey && !disabled) inputRef.current?.focus();
  }, [focusKey, disabled]);

  const toggleMic = async () => {
    setVoiceError(null);
    if (!isRecording) { await start(); return; }
    const rec = await stop();
    if (!rec?.blob || rec.blob.size === 0) { setVoiceError("Didn't hear anything — try again or type it."); return; }
    setTranscribing(true);
    const t0 = performance.now();
    try {
      const audioBase64 = await blobToBase64(rec.blob);
      const out = await DaylightAPI('api/v1/ai/transcribe', { audioBase64 }, 'POST');
      const text = String(out?.text ?? '').trim();
      logger.info('triage.voice.transcribed', { ms: Math.round(performance.now() - t0), chars: text.length, audioMs: rec.durationMs ?? null });
      if (!text) { setVoiceError("Couldn't make that out — try again or type it."); return; }
      onChange(value ? `${value} ${text}` : text);
      inputRef.current?.focus();
    } catch (err) {
      logger.warn('triage.voice.failed', { error: err?.message, status: err?.status ?? null });
      setVoiceError("Couldn't transcribe that — type it instead.");
    } finally {
      setTranscribing(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSubmit(value.trim());
  };

  const inlineError = voiceError ?? (micError ? `${micError} Type it instead.` : null);
  return (
    <form className="life-triage__answer" onSubmit={submit}>
      {prompt && <Text size="sm" fw={600} className="life-triage__prompt">{prompt}</Text>}
      <div className="life-triage__answer-row">
        <TextInput
          ref={inputRef}
          className="life-triage__answer-input"
          aria-label="Answer in your own words"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          disabled={disabled}
          radius="md"
          size="md"
        />
        {value.trim() ? (
          <ActionIcon type="submit" size={42} radius="xl" variant="filled" aria-label="Send answer" disabled={disabled}>
            <IconArrowUp size={20} />
          </ActionIcon>
        ) : null}
        <ActionIcon
          type="button"
          size={42}
          radius="xl"
          variant={isRecording ? 'filled' : 'light'}
          color={isRecording ? 'red' : undefined}
          aria-label={isRecording ? 'Stop recording' : 'Speak your answer'}
          onClick={toggleMic}
          disabled={disabled || transcribing}
        >
          {transcribing ? <Loader size={16} /> : isRecording ? <IconPlayerStopFilled size={18} /> : <IconMicrophone size={20} />}
        </ActionIcon>
      </div>
      {isRecording && <Text size="xs" c="dimmed" mt={4}>Listening… tap stop when you&apos;re done.</Text>}
      {inlineError && <Text size="xs" c="red" mt={4} role="alert">{inlineError}</Text>}
    </form>
  );
}

export default AnswerInput;
