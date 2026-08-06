/**
 * PinPrompt — the console PIN entry (spec §1: soft reads, PIN mutations).
 * One instance, rendered by the shell; panels open it when a write comes
 * back 403. The pin lives in context memory only; the server re-checks it
 * on every write regardless.
 */
import { useState } from 'react';
import { useTeacherProfile } from '../TeacherProfileContext.jsx';

export default function PinPrompt() {
  const { pinPromptOpen, setPin, closePinPrompt } = useTeacherProfile();
  const [value, setValue] = useState('');
  if (!pinPromptOpen) return null;
  return (
    <div className="teacher-pin" role="dialog" aria-label="Teacher PIN">
      <div className="teacher-pin__card">
        <h3>Teacher PIN</h3>
        <p>Marking work and approvals need the console PIN.</p>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="PIN"
        />
        <div className="teacher-pin__actions">
          <button type="button" onClick={() => { setPin(value); setValue(''); }}>Save</button>
          <button type="button" onClick={() => { setValue(''); closePinPrompt(); }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
