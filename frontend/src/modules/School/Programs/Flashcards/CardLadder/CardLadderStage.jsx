import { useEffect, useState } from 'react';
import { AppThemeProvider } from '../../../../../lib/ui/index.js';
import { schoolApi } from '../../../schoolApi.js';
import { cardLadderLog } from './cardLadderLog.js';

/**
 * The fixed stage (spec §6 Stage): the target screen's resolution, from config,
 * centred and uniformly scaled — what a grown-up sees is what the child sees.
 */
export default function CardLadderStage({ children }) {
  const [size, setSize] = useState(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const stage = await fetch('/api/v1/school/card-ladder/stage').then((r) => r.json());
        const { ok, data } = stage?.screen ? await schoolApi.screenSchoolConfig(stage.screen) : { ok: false };
        const res = ok ? data?.resolution : null;
        if (!res?.width || !res?.height) throw new Error('no resolution');
        if (live) setSize({ width: res.width, height: res.height });
      } catch (error) {
        cardLadderLog.stageFailed({ error: error.message });
        if (live) setSize({ width: window.innerWidth, height: window.innerHeight });
      }
    })();
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!size) return undefined;
    const fit = () => setScale(Math.min(window.innerWidth / size.width, window.innerHeight / size.height, 1));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [size]);
  if (!size) return null;
  return (
    <AppThemeProvider pack="school">
      <div className="wl-stage-frame">
        <div className="wl-stage" style={{ width: size.width, height: size.height, transform: `scale(${scale})` }}>
          {children}
        </div>
      </div>
    </AppThemeProvider>
  );
}
