import { useMemo, useState, useEffect } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import { AbcRenderer, generateMelodyAbc } from '../../../../MusicNotation/index.js';

/** Render a drill's tempo object as text, whatever shape it takes. */
function tempoText(tempo) {
  if (!tempo) return null;
  const unit = tempo.unit === 'quarter' ? '♩' : tempo.unit || '♩';
  if (tempo.start_bpm != null && tempo.target_bpm != null) return `${unit} = ${tempo.start_bpm} → ${tempo.target_bpm}`;
  if (tempo.bpm != null) return `${unit} = ${tempo.bpm}`;
  return tempo.note || null;
}

/**
 * Generic single-drill view. Fetches a drill module from a lesson collection and
 * renders its notated figure (with fingering) plus whatever metadata fields the
 * module supplies. Content-agnostic: no per-collection assumptions.
 */
export default function LessonDrill({ collection, drillId }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-lesson-drill' }), []);
  const [drill, setDrill] = useState(undefined); // undefined = loading, null = not found

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        logger.info('piano.drill-open', { collection, id: drillId });
        const data = await DaylightAPI(`api/v1/piano/lessons/${collection}/${drillId}`);
        if (!cancelled) setDrill(data || null);
      } catch (err) {
        if (!cancelled) setDrill(null);
        logger.warn('piano.drill-open-failed', { collection, id: drillId, error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [logger, collection, drillId]);

  usePianoBreadcrumb(useMemo(() => [{ label: drill?.title || 'Drill' }], [drill?.title]));

  const abc = useMemo(() => (drill ? generateMelodyAbc(drill, drill.key || 'C') : null), [drill]);
  const tempo = tempoText(drill?.tempo);

  if (drill === undefined) return <div className="piano-mode piano-mode--lessons"><p className="piano-mode__placeholder">Loading…</p></div>;
  if (drill === null) return <div className="piano-mode piano-mode--lessons"><p className="piano-mode__placeholder">This drill could not be loaded.</p></div>;

  return (
    <section className="piano-mode piano-mode--lessons lesson-drill">
      <header className="lesson-drill__header">
        <h1 className="lesson-drill__title">{drill.title}</h1>
        {drill.subtitle && <p className="lesson-drill__subtitle">{drill.subtitle}</p>}
      </header>

      <div className="lesson-drill__staff">
        {abc && <AbcRenderer abc={abc} scale={2} className="abc-renderer lesson-drill__abc" />}
      </div>

      <dl className="lesson-drill__facts">
        {drill.meter && (<><dt>Meter</dt><dd>{drill.meter}</dd></>)}
        {drill.key && (<><dt>Key</dt><dd>{drill.key}</dd></>)}
        {tempo && (<><dt>Tempo</dt><dd>{tempo}</dd></>)}
        {drill.transpose?.mode && (
          <>
            <dt>Pattern</dt>
            <dd>
              {drill.transpose.mode}
              {drill.transpose.span_octaves ? `, ${drill.transpose.span_octaves} octaves ${drill.transpose.direction || ''}` : ''}
            </dd>
          </>
        )}
      </dl>

      {drill.focus && <p className="lesson-drill__focus">{drill.focus}</p>}
    </section>
  );
}
