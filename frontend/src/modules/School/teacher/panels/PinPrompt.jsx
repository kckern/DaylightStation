/** PIN entry for initial unlocks and resource-scoped sensitive actions. */
import { useEffect, useRef, useState } from 'react';
import { useTeacherProfile } from '../TeacherProfileContext.jsx';

export default function PinPrompt() {
  const {
    pinPromptOpen, pinPromptBusy, pinPromptError, pinPromptAction,
    submitPin, closePinPrompt,
  } = useTeacherProfile();
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!pinPromptOpen) setValue('');
    else inputRef.current?.focus();
  }, [pinPromptOpen]);

  if (!pinPromptOpen) return null;
  const steppingUp = Boolean(pinPromptAction);
  const submit = (event) => {
    event.preventDefault();
    submitPin(value);
  };
  return (
    <div className="teacher-pin" role="dialog" aria-modal="true" aria-label="Teacher PIN">
      <form className="teacher-pin__card" onSubmit={submit}>
        <h3>{steppingUp ? 'Confirm sensitive action' : 'Unlock teacher tools'}</h3>
        <p>{steppingUp
          ? 'Enter the teacher PIN again. This confirmation applies only to this action.'
          : 'Enter the teacher PIN to authorize changes for this visit.'}</p>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          disabled={pinPromptBusy}
          onChange={(event) => setValue(event.target.value)}
          aria-label="PIN"
          aria-invalid={Boolean(pinPromptError)}
        />
        {pinPromptError && <p className="teacher-panel__error" role="alert">{pinPromptError}</p>}
        <div className="teacher-pin__actions">
          <button type="submit" disabled={pinPromptBusy || !value.trim()}>{pinPromptBusy ? 'Checking…' : 'Continue'}</button>
          <button type="button" disabled={pinPromptBusy} onClick={closePinPrompt}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
