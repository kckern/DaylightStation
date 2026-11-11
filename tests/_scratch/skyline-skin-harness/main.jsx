// Renders the real FlightScene for one act + zone at one course time.
//   /?act=mountain-pass&zone=smw-placeholder&t=40&alt=0.5
// The Vite middleware resolves the act onto the zone with the server's own
// resolveAct; this page validates it with the browser course model, loads the
// zone's files with the game's loadZoneAssets, and draws one frame.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FlightScene } from '../../../__app_modules/wellness/fitness/browser/widgets/SkylineGlider/FlightScene.jsx';
import '../../../__app_modules/wellness/fitness/browser/widgets/SkylineGlider/SkylineGlider.scss';
import { validateCourse, resolveCalibration } from '../../../__app_modules/wellness/fitness/browser/lib/skylineGlider/courseModel.js';
import { createFlightState } from '../../../__app_modules/wellness/fitness/browser/lib/skylineGlider/flightEngine.js';
import { FlightUi, MenuUi, flightFixture } from './ui.jsx';
import { loadZoneAssets } from '../../../__app_modules/wellness/fitness/browser/lib/skylineGlider/zoneAssets.js';

const params = new URLSearchParams(location.search);
const act = params.get('act') || 'mountain-pass';
const zone = params.get('zone') || 'alpine';
const scene = params.get('scene');
const fx = (params.get('fx') || '').split(',').filter(Boolean);
const t = Number(params.get('t') || 20);
const alt = Number(params.get('alt') || 0.5);

// freeze=<seconds> holds every animation at that moment, so a shot of a
// half-second effect is the same picture every run.
if (params.has('freeze')) {
  const style = document.createElement('style');
  style.textContent = `*, *::before, *::after { animation-play-state: paused !important; animation-delay: -${Number(params.get('freeze')) || 0}s !important; }`;
  document.head.append(style);
}

async function boot() {
  const root = createRoot(document.getElementById('root'));
  if (scene === 'menu') { root.render(<MenuUi phase={params.get('phase') || 'identity'}/>); return; }
  const raw = await (await fetch(`/harness/course?act=${act}&zone=${zone}`)).json();
  if (raw.error) throw new Error(raw.error);
  const checked = validateCourse(raw);
  if (!checked.valid) throw new Error(`course invalid: ${checked.errors.join('; ')}`);
  const course = checked.course;
  const assets = await loadZoneAssets(course.zone, { mediaUrl: (p) => `/media/${p}` });
  const state = { ...createFlightState(course, { calibration: resolveCalibration({}, course), courseTime: t, altitude: alt }), collectedIds: [], destroyedIds: [] };
  window.__harness = { missing: assets.missing, frames: assets.frames ? Object.keys(assets.frames).length : 0, images: assets.images.size, zone: course.zone.id, pixel_scale: course.zone.pixel_scale };
  if (scene === 'flight') { root.render(<FlightUi state={flightFixture(state, course, t, fx)} course={course} assets={assets} fx={fx}/>); return; }
  root.render(<div className="stage" data-harness-ready="true"><FlightScene state={state} course={course} assets={assets}/></div>);
}
boot().catch((error) => { document.body.dataset.harnessError = error.message; document.body.textContent = error.message; });
