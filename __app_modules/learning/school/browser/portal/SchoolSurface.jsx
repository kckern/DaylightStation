import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppThemeProvider } from '#frontend/lib/ui/AppThemeProvider.jsx';
import { createAppLogger } from '#frontend/lib/ui/createAppLogger.js';
import { createSchoolApi, schoolApi } from '../schoolApi.js';
import { createSchoolResourceStore } from '../runtime/schoolResources.js';
import './SchoolPortal.scss';

const fallback = Object.freeze({ provided: false, surfaceId: 'browser', deviceId: null, density: 'touch', bounds: Object.freeze({ width: 0, height: 0 }), overlayRoot: null, resourceStore: createSchoolResourceStore(), api: schoolApi });
const SchoolSurfaceContext = createContext(null);
const log = createAppLogger('school').child('surface');
const dimension = value => Number.isFinite(value) ? Math.max(0, value) : 0;

/** School visual host; identity is local and never mutates global device state. */
export function SchoolSurfaceProvider({ surfaceId = 'browser', deviceId = null, density = 'touch', children }) {
  const parent = useContext(SchoolSurfaceContext);
  const hostRef = useRef(null);
  const resourceStore = useMemo(createSchoolResourceStore, []);
  const api = useMemo(() => createSchoolApi({ deviceId }), [deviceId]);
  const [bounds, setBounds] = useState(fallback.bounds);
  const [overlayRoot, setOverlayRoot] = useState(null);
  useEffect(() => {
    const host = hostRef.current;
    const measure = rect => {
      const next = { width: dimension(rect.width), height: dimension(rect.height) };
      setBounds(previous => previous.width === next.width && previous.height === next.height ? previous : next);
    };
    measure(host.getBoundingClientRect());
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
      const entry = entries.find(item => item.target === host);
      if (entry) measure(entry.contentRect);
    }) : null;
    const resize = () => measure(host.getBoundingClientRect());
    observer?.observe(host);
    if (!observer) window.addEventListener('resize', resize);
    log.info('school.surface.mounted', { surfaceId, deviceId, density });
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      log.info('school.surface.unmounted', { surfaceId, deviceId });
    };
  }, [surfaceId, deviceId, density]);
  const value = useMemo(() => ({ provided: true, surfaceId, deviceId, density, bounds, overlayRoot, resourceStore, api }), [surfaceId, deviceId, density, bounds, overlayRoot, resourceStore, api]);
  const host = <SchoolSurfaceContext.Provider value={value}>
    <div ref={hostRef} className="school-surface" data-school-surface={surfaceId} data-density={density}>
      {children}
      <div ref={setOverlayRoot} className="school-surface__overlays" data-school-overlay={surfaceId} />
    </div>
  </SchoolSurfaceContext.Provider>;
  // A nested host inherits its school pack instead of stacking Mantine/theme roots.
  return parent ? host : <AppThemeProvider pack="school" forceColorScheme="dark" className="school-surface-theme" style={{ minHeight: 0 }}>{host}</AppThemeProvider>;
}

export function useSchoolSurface() { return useContext(SchoolSurfaceContext) || fallback; }
export default SchoolSurfaceProvider;
