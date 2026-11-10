/**
 * SettingsPanel — plain choices for what the filter does (five language groups,
 * violence, nudity, sexual content), applied to this film or everywhere. Reads the
 * merged profile the player received; each choice writes only what changed (the
 * server merges), then refreshes the player's filter. Segmented buttons, mouse-only.
 */
import React, { useMemo, useState } from 'react';
import { useFilterPreview } from './previewStore.js';
import { useFilterWrite } from './useFilterWrite.js';
import { settingsFromProfile, resolveBleepLevel, clampBleepLevel } from '../../../../../../shared/contracts/content-filter/filterSettings.mjs';
import { DaylightAPI } from '../../../../../../frontend/src/lib/api.mjs';
import { getChildLogger } from '../../../../../../frontend/src/lib/logging/singleton.js';

const PROFILE_NAME = 'family';
const LEVELS = [['off', 'Off'], ['blur', 'Blur'], ['blackout', 'Blackout'], ['skip', 'Skip']];
const SOUND = [['mute', 'Mute'], ['bleep', 'Bleep'], ['off', 'Off']];
// Language is five groups (R9); `lang` names the group inside the `language` setting.
const ROWS = [
  { key: 'profanity', lang: 'profanity', label: 'Profanity', options: SOUND },
  { key: 'blasphemy', lang: 'blasphemy', label: 'Blasphemy', options: SOUND },
  { key: 'sexual-language', lang: 'sexual', label: 'Sexual language', options: SOUND },
  { key: 'slurs', lang: 'slurs', label: 'Slurs', options: SOUND },
  { key: 'childish', lang: 'childish', label: 'Childish words', options: SOUND },
  { key: 'violence', label: 'Violence', options: LEVELS },
  { key: 'nudity', label: 'Nudity', options: LEVELS },
  { key: 'sexual', label: 'Sexual content', options: LEVELS },
];

export default function SettingsPanel() {
  const snap = useFilterPreview();
  const logger = useMemo(() => getChildLogger({ app: 'content-filter', component: 'settings-panel' }), []);
  const { error, busy, write } = useFilterWrite(logger);
  const [scope, setScope] = useState('film'); // 'film' | 'everywhere'
  const rk = snap.ratingKey;
  if (rk == null) return null;

  const current = settingsFromProfile(snap.profile);
  const hasFilmSettings = !!snap.override?.profilePatch;
  const base = `/api/v1/content-filter`;

  const valueOf = (row) => (row.lang ? current.language[row.lang] : current[row.key]);
  const choose = (row, value) => {
    if (valueOf(row) === value) return;
    const settings = row.lang ? { language: { [row.lang]: value } } : { [row.key]: value }; // only the change; the server merges over its own current values
    const url = scope === 'film' ? `${base}/${encodeURIComponent(rk)}/settings` : `${base}/profiles/${PROFILE_NAME}/settings`;
    return write(
      () => DaylightAPI(url, { settings }, 'PUT'),
      'content-filter.setting.changed', { ratingKey: rk, scope, setting: row.lang ? `language.${row.lang}` : row.key, value },
    );
  };
  const level = resolveBleepLevel(snap.profile);
  const stepLevel = (delta) => {
    const next = clampBleepLevel(level + delta);
    if (next === level) return;
    const url = scope === 'film' ? `${base}/${encodeURIComponent(rk)}/settings` : `${base}/profiles/${PROFILE_NAME}/settings`;
    return write(
      () => DaylightAPI(url, { settings: { bleepLevel: next } }, 'PUT'),
      'content-filter.setting.changed', { ratingKey: rk, scope, setting: 'bleepLevel', value: next },
    );
  };
  const reset = () => write(
    () => DaylightAPI(`${base}/${encodeURIComponent(rk)}/settings`, {}, 'DELETE'),
    'content-filter.setting.changed', { ratingKey: rk, scope: 'film', setting: 'all', value: 'reset' },
  );

  return (
    <div data-testid="settings-panel">
      <section className="filter-rail__section">
        <h4>Apply to</h4>
        <div className="filter-rail__buttons">
          {[['film', 'This film'], ['everywhere', 'Everywhere']].map(([v, label]) => (
            <button key={v} type="button" aria-pressed={scope === v} className={`filter-rail__btn${scope === v ? ' is-selected' : ''}`} onClick={() => setScope(v)}>{label}</button>
          ))}
        </div>
        {scope === 'everywhere' && hasFilmSettings ? <div className="filter-rail__empty">This film has its own settings, which win here.</div> : null}
      </section>
      {ROWS.map((row) => (
        <section key={row.key} className="filter-rail__section">
          <h4>{row.label}</h4>
          <div className="filter-rail__buttons" role="group" aria-label={row.label}>
            {row.options.map(([v, label]) => (
              <button key={v} type="button" aria-pressed={valueOf(row) === v} className={`filter-rail__btn${valueOf(row) === v ? ' is-selected' : ''}`} disabled={busy} onClick={() => choose(row, v)}>{label}</button>
            ))}
          </div>
        </section>
      ))}
      <section className="filter-rail__section">
        <h4>Bleep volume</h4>
        <div className="filter-rail__buttons" role="group" aria-label="Bleep volume">
          <button type="button" className="filter-rail__btn" aria-label="Quieter bleep" disabled={busy} onClick={() => stepLevel(-0.05)}>-</button>
          <span data-testid="bleep-level">{Math.round(level * 100)}%</span>
          <button type="button" className="filter-rail__btn" aria-label="Louder bleep" disabled={busy} onClick={() => stepLevel(0.05)}>+</button>
        </div>
      </section>
      <section className="filter-rail__section">
        <button type="button" className="filter-rail__btn" disabled={busy || !hasFilmSettings} onClick={reset}>Reset this film</button>
        {error ? <div className="filter-rail__error" role="alert">{error}</div> : null}
      </section>
    </div>
  );
}
