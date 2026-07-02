import React from 'react';
import PropTypes from 'prop-types';

/** Map-pins-and-route glyph for the Distance race type (svgrepo 447602). */
export function DistanceIcon() {
  return (
    <svg className="cgh-tile__icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true" focusable="false">
      <path d="M17.94,54.81a.1.1,0,0,1-.14,0c-1-1.11-11.69-13.23-11.69-21.26,0-9.94,6.5-12.24,11.76-12.24,4.84,0,11.06,2.6,11.06,12.24C28.93,41.84,18.87,53.72,17.94,54.81Z" />
      <circle cx="17.52" cy="31.38" r="4.75" />
      <path d="M49.58,34.77a.11.11,0,0,1-.15,0c-.87-1-9.19-10.45-9.19-16.74,0-7.84,5.12-9.65,9.27-9.65,3.81,0,8.71,2,8.71,9.65C58.22,24.52,50.4,33.81,49.58,34.77Z" />
      <circle cx="49.23" cy="17.32" r="3.75" />
      <path d="M17.87,54.89a28.73,28.73,0,0,0,3.9.89" />
      <path d="M24.68,56.07c2.79.12,5.85-.28,7.9-2.08,5.8-5.09,2.89-11.25,6.75-14.71a16.72,16.72,0,0,1,4.93-3" strokeDasharray="7.8 2.92" />
      <path d="M45.63,35.8a23,23,0,0,1,3.88-.95" />
    </svg>
  );
}

/** Stopwatch glyph for the Time race type (svgrepo 532129). */
export function TimeIcon() {
  return (
    <svg className="cgh-tile__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M12 14V11M12 6C7.85786 6 4.5 9.35786 4.5 13.5C4.5 17.6421 7.85786 21 12 21C16.1421 21 19.5 17.6421 19.5 13.5C19.5 11.5561 18.7605 9.78494 17.5474 8.4525M12 6C14.1982 6 16.1756 6.94572 17.5474 8.4525M12 6V3M19.5 6.5L17.5474 8.4525M12 3H9M12 3H15"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

/** Speedometer/gauge glyph for the km/h high-score categories. */
export function SpeedIcon() {
  return (
    <svg className="cgh-tile__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M4.5 17.5A9 9 0 1 1 19.5 17.5" />
      <path d="M12 13.5 16 8.5" />
      <circle cx="12" cy="13.5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Ghost glyph for the Ghost race type (svgrepo 507709). */
export function GhostIcon() {
  return (
    <svg className="cgh-tile__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M12 3C7.02944 3 3 7.02944 3 12V19.0093C3 20.7408 5.05088 21.6542 6.33793 20.4959L6.98682 19.9119C7.59805 19.3618 8.48368 19.2418 9.21918 19.6096L11.1056 20.5528C11.6686 20.8343 12.3314 20.8343 12.8944 20.5528L14.7808 19.6096C15.5163 19.2418 16.402 19.3618 17.0132 19.9119L17.6621 20.4959C18.9491 21.6542 21 20.7408 21 19.0093V12C21 7.02944 16.9706 3 12 3Z" stroke="currentColor" strokeWidth="2" />
      <path d="M8 14C8.91221 15.2144 10.3645 16 12.0004 16C13.6362 16 15.0885 15.2144 16.0007 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M9 10.0112V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M15 10.0112V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Checkered race-flag glyph for the Start button (svgrepo 3532). */
export function RaceFlagIcon() {
  return (
    <svg className="cgh-start-flag" viewBox="0 0 37.979 37.979" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M21.553,2.322C15.45,3.435,9.956,6.693,2.608,3.406c0.096,0.333,0.189,0.667,0.283,1h-1.75L1,3.906H0l8.988,31.75h1l-4.01-14.167h1.75c0.109,0.39,0.221,0.778,0.33,1.168C15.405,25.942,20.9,22.684,27,21.571C25.186,15.155,23.369,8.738,21.553,2.322z M9.796,5.831c2.07-0.046,4.032-0.473,5.971-0.983c0.521,1.833,1.039,3.667,1.559,5.5c-1.938,0.51-3.901,0.937-5.973,0.983C10.834,9.497,10.314,7.664,9.796,5.831z M5.766,20.739L1.354,5.156h1.75c1.472,5.194,2.941,10.389,4.412,15.583H5.766z M7.173,15.991c-0.508-1.792-1.017-3.583-1.522-5.375c2.046,0.751,3.951,1.005,5.773,0.964c0.507,1.792,1.015,3.583,1.521,5.375C11.125,16.996,9.219,16.742,7.173,15.991z M20.651,22.098c-1.938,0.511-3.9,0.937-5.972,0.982c-0.519-1.834-1.038-3.667-1.558-5.5c2.069-0.046,4.032-0.473,5.973-0.983C19.613,18.432,20.133,20.264,20.651,22.098z M24.039,14.635c-1.729,0.375-3.414,0.889-5.121,1.337c-0.508-1.792-1.016-3.583-1.521-5.375c1.706-0.449,3.395-0.962,5.12-1.337C23.023,11.052,23.531,12.843,24.039,14.635z M23.227,5.446c0.096,0.333,0.189,0.667,0.283,1c0.787-0.118,1.584-0.195,2.398-0.213c0.52,1.833,1.037,3.667,1.557,5.5c-0.813,0.018-1.611,0.095-2.396,0.213c0.591,2.083,1.181,4.167,1.771,6.25c0.785-0.118,1.584-0.195,2.396-0.213c0.521,1.833,1.039,3.667,1.56,5.5c-2.07,0.045-4.033,0.473-5.974,0.981c-0.121-0.432-0.243-0.86-0.364-1.291c-2.018,0.529-4.008,1.15-6.068,1.525c0.217,0.766,0.434,1.529,0.649,2.293c6.101-1.113,11.597-4.371,18.94-1.086c-1.814-6.416-3.633-12.833-5.449-19.25C29.11,5.128,26.094,5.015,23.227,5.446z M34.833,18.322c-2.046-0.751-3.95-1.005-5.772-0.964c-0.508-1.792-1.016-3.583-1.521-5.375c1.82-0.041,3.727,0.213,5.771,0.964C33.817,14.739,34.326,16.53,34.833,18.322z" />
    </svg>
  );
}

/** Octagonal stop-sign glyph for the DNF chart/toast marker (was 🛑). */
export function StopSignIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8Z" />
      <line x1="7" y1="12" x2="17" y2="12" strokeLinecap="round" />
    </svg>
  );
}

/** No-entry / prohibition glyph for a served false-start penalty (was ⛔). */
export function NoEntryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <line x1="5.5" y1="18.5" x2="18.5" y2="5.5" />
    </svg>
  );
}

/** Ribboned medal glyph for the current-leader badge (was 🥇). */
export function MedalIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M7 2 4 9l3 2 3-7Z" />
      <path d="M17 2l3 7-3 2-3-7Z" />
      <circle cx="12" cy="15" r="7" />
      <circle cx="12" cy="15" r="3.2" fill="#0a0a14" />
    </svg>
  );
}

/** Speaker glyph for the volume control; a muted variant swaps the waves for an ✕. */
export function VolumeIcon({ muted }) {
  return (
    <svg className="cgh-volume-fab__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" stroke="none" />
      {muted ? (
        <path d="m15 9 5 6M20 9l-5 6" />
      ) : (
        <>
          <path d="M15.5 8.8a4.5 4.5 0 0 1 0 6.4" />
          <path d="M18.4 6a8.5 8.5 0 0 1 0 12" />
        </>
      )}
    </svg>
  );
}
VolumeIcon.propTypes = { muted: PropTypes.bool };
