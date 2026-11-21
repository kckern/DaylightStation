import { useEffect, useLayoutEffect, useRef } from 'react';
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';
import { PACKS } from '../../../../../frontend/src/lib/theme/packs.mjs';
import { dsCssVars } from '../../../../../frontend/src/lib/theme/tokens.mjs';
import { Button } from '../../../../../frontend/src/lib/ui/Button.jsx';
import { StateMessage } from '../../../../../frontend/src/lib/ui/states.jsx';
import { useFocusRegion } from '../../../../../frontend/src/lib/ui/useRetryRegion.js';
import { useSheetSubmission } from '../../../../../frontend/src/lib/ui/useSheetSubmission.js';

const homeTokens = dsCssVars(PACKS.home);

export default function PowerOffAction({ path, target, clear }) {
  const latestClear = useRef(clear);
  const started = useRef(false);
  const closed = useRef(false);
  useLayoutEffect(() => { latestClear.current = clear; }, [clear]);

  const close = () => {
    if (closed.current) return;
    closed.current = true;
    latestClear.current();
  };
  const { run, saving, failure } = useSheetSubmission(close);
  const { regionProps, focus } = useFocusRegion(saving);
  const turnOff = () => run(async () => {
    const result = await DaylightAPI(path);
    if (result?.ok === false) throw new Error(result.error || 'The TV did not confirm it was off.');
  }, { valid: !closed.current });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void turnOff();
  }, [turnOff]);

  return (
    <StateMessage
      {...regionProps}
      style={homeTokens}
      role={failure ? 'alert' : 'status'}
      state={failure ? 'error' : 'loading'}
      title={failure ? `Couldn’t turn off ${target}` : `Turning off ${target}…`}
      detail={failure?.message}
    >
      {failure && <Button variant="secondary" onClick={() => { focus(); void turnOff(); }}>Retry</Button>}
      <Button variant="secondary" onClick={close}>Close</Button>
    </StateMessage>
  );
}
