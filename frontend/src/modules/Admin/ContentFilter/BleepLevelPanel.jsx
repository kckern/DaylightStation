import { Button, Group, Text } from '@mantine/core';
import { createAppLogger } from '../../../lib/ui/index.js';
import { createBleepTone } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';

/**
 * The bleep volume in one place (owner, 2026-11-22: "where is settings where I can adjust the global /
 * movie / cue bleep volume?"): the household level every film follows, and this film's own level
 * (or "Follows household"). Levels are 0..1, shown as whole percent, moved in 5 % steps; no sliders.
 */
const logger = createAppLogger('admin').child('content-filter');
export const BLEEP_LEVEL_STEP = 0.05;
const pct = (v) => `${Math.round(v * 100)} %`;
const clamp = (v) => Math.min(1, Math.max(0, Math.round(v * 100) / 100));

/** Play one short bleep at `level` (a no-op where Web Audio is missing; the first press may only wake the audio). */
export function playTestBleep(level) {
  try {
    const tone = createBleepTone({ level });
    if (!tone.start()) { setTimeout(() => {
      if (tone.start()) setTimeout(() => tone.stop(), 450);
      else logger.debug('content_filter.review.bleep_test_silent', { level });
    }, 120); return; }
    setTimeout(() => tone.stop(), 450);
  } catch (err) { logger.debug('content_filter.review.bleep_test_silent', { level, error: err.message }); }
}

function Row({ label, value, follows, followsText = 'Follows household', onStep, children, valueWidth = 92 }) {
  return (
    <Group gap="xs" wrap="nowrap" className="cf-bleep__row">
      <Text size="sm" w={110}>{label}</Text>
      <Button size="compact-sm" variant="default" aria-label={`${label} quieter`} title={`Make the ${label.toLowerCase()} bleep 5 % quieter`} onClick={() => onStep(-BLEEP_LEVEL_STEP)}>−</Button>
      <Text size="sm" fw={600} w={valueWidth} ta="center" aria-label={`${label} level`}>{follows ? followsText : pct(value)}</Text>
      <Button size="compact-sm" variant="default" aria-label={`${label} louder`} title={`Make the ${label.toLowerCase()} bleep 5 % louder`} onClick={() => onStep(BLEEP_LEVEL_STEP)}>+</Button>
      {children}
    </Group>
  );
}

export function BleepLevelPanel({ household, film, onFilm, onHousehold, onTest }) {
  const shown = film ?? household;
  return (
    <div className="cf-bleep" role="group" aria-label="Bleep volume">
      <Row label="Household" value={household} onStep={(d) => onHousehold(clamp(household + d))} />
      <Row label="This film" value={shown} follows={film == null} onStep={(d) => onFilm(clamp(shown + d))}>
        <Button size="compact-sm" variant="subtle" disabled={film == null} title="Drop this film's own level and follow the household level" onClick={() => onFilm(null)}>Follow household</Button>
      </Row>
      <Group gap="xs" mt="xs">
        <Button size="compact-sm" variant="light" title="Play a short bleep at the level this film uses" onClick={() => onTest?.()}>Test bleep</Button>
        <Text size="xs" c="dimmed">Keys: <kbd className="cf-keybar__key">[</kbd> quieter, <kbd className="cf-keybar__key">]</kbd> louder (this film)</Text>
      </Group>
    </div>
  );
}

/**
 * One cue's own bleep level (the part card's and the part menu's "Bleep volume for this cue…"):
 * `value` is the cue's level or null (it follows the film, whose level is `film`). A step starts
 * from what the cue plays at now; "Follow film" drops the cue's own level.
 */
export function CueBleepLevel({ value, film, onSet, onTest }) {
  const follows = value == null;
  const shown = follows ? film : value;
  return (
    <div className="cf-bleep" role="group" aria-label="Bleep volume for this cue">
      <Row label="This cue" value={shown} follows={follows} followsText={`Follows film (${pct(film)})`} valueWidth={140}
        onStep={(d) => onSet(clamp(shown + d))}>
        <Button size="compact-sm" variant="subtle" disabled={follows} title="Drop this cue's own level and follow the film's level" onClick={() => onSet(null)}>Follow film</Button>
      </Row>
      {onTest ? (
        <Group gap="xs" mt="xs">
          <Button size="compact-sm" variant="light" title="Play a short bleep at this cue's level" onClick={() => onTest(shown)}>Test bleep</Button>
        </Group>
      ) : null}
    </div>
  );
}

export default BleepLevelPanel;
