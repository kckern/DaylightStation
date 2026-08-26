/**
 * RingIcon — the canonical mark for a fitness ring.
 *
 * Ported from `media/fitness/ux/spinning-ring.svg` into the codebase, because
 * an <img> to a GIF or SVG can be neither reduced-motion-gated nor
 * ID-namespaced, and this icon needs both.
 *
 * WHY IT IS A COMPONENT AND NOT A RAW SVG STRING
 * ----------------------------------------------
 * The source declares eight document-level IDs — `title`, `description`,
 * `orange-band`, `gold-band`, `face-gloss`, `ring-shadow`, `depth-slice`,
 * `gold-face`. The school status board renders one of these per child, so
 * inlining the raw string four times would put four copies of each ID in one
 * document and make every `url(#orange-band)` reference ambiguous. `useId()`
 * gives each instance its own prefix, interpolated in JSX rather than regexed
 * into a string at runtime — ID bugs are invisible until they render wrong,
 * so they should not depend on a regex holding.
 *
 * It is deliberately NOT part of `School/home/icons/Icon.jsx`, whose contract
 * is a flat `currentColor` glyph. This is a fixed gold-gradient illustration.
 *
 * MOTION
 * ------
 * Static by default. The board is the surface with four instances and an
 * explicit one-motion budget, so the safe presentation is what a caller gets
 * without thinking about it. `prefers-reduced-motion` overrides `spin`
 * entirely — see RingIcon.scss, where every animation now lives in CSS
 * precisely so one media query can stop all of it.
 */
import { useId } from 'react';
import './RingIcon.scss';

// Signed depth of each extruded slice, front face last. These were the
// amplitudes of the source's eight <animateTransform> elements; the shared
// keyframe multiplies each by sin(2πt).
const SLICE_DEPTHS = [-14, -10, -6, -2, 2, 6, 10];
const FACE_DEPTH = 14;

export default function RingIcon({
  size = '1em',
  spin = false,
  label = null,
  className = '',
}) {
  // React's useId contains colons, which are legal in an HTML id but a menace
  // inside url(#…) and CSS selectors. Strip them.
  const uid = `ring-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const id = (name) => `${uid}-${name}`;
  const url = (name) => `url(#${id(name)})`;

  const spinClass = spin === 'once'
    ? ' ring-icon--spin-once'
    : spin ? ' ring-icon--spin' : '';

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={`ring-icon${spinClass}${className ? ` ${className}` : ''}`}
      {...(label
        ? { role: 'img', 'aria-labelledby': id('title') }
        : { 'aria-hidden': 'true', focusable: 'false' })}
    >
      {label && <title id={id('title')}>{label}</title>}

      <defs>
        <linearGradient id={id('orange-band')} x1="-145" y1="-155" x2="150" y2="165" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffca31" />
          <stop offset="0.38" stopColor="#ff9519" />
          <stop offset="0.72" stopColor="#ffb71b" />
          <stop offset="1" stopColor="#e96c16" />
        </linearGradient>

        <linearGradient id={id('gold-band')} x1="-126" y1="-168" x2="132" y2="174" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff8bd" />
          <stop offset="0.19" stopColor="#ffe45c" />
          <stop offset="0.48" stopColor="#ff9f13" />
          <stop offset="0.75" stopColor="#ffe66a" />
          <stop offset="1" stopColor="#ef860a" />
        </linearGradient>

        <linearGradient id={id('face-gloss')} x1="-154" y1="-132" x2="147" y2="157" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fffde8" stopOpacity="0.94" />
          <stop offset="0.28" stopColor="#fff3ae" stopOpacity="0.7" />
          <stop offset="0.57" stopColor="#ffc52b" stopOpacity="0.04" />
          <stop offset="1" stopColor="#fff0a0" stopOpacity="0.5" />
        </linearGradient>

        <filter id={id('ring-shadow')} x="-35%" y="-35%" width="170%" height="185%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="12" stdDeviation="9" floodColor="#641a15" floodOpacity="0.3" />
        </filter>

        {/* One dark slice of the ring's extruded body. */}
        <g id={id('depth-slice')}>
          <circle cx="0" cy="0" r="156" fill="none" stroke="currentColor" strokeWidth="96" />
        </g>

        {/* The decorated front surface. */}
        <g id={id('gold-face')}>
          <circle cx="0" cy="0" r="156" fill="none" stroke="#9f2a20" strokeWidth="96" />
          <circle cx="0" cy="0" r="203" fill="none" stroke="#792019" strokeWidth="5" />
          <circle cx="0" cy="0" r="109" fill="none" stroke="#792019" strokeWidth="5" />
          <circle cx="0" cy="0" r="156" fill="none" stroke={url('orange-band')} strokeWidth="76" />
          <circle cx="0" cy="0" r="156" fill="none" stroke={url('gold-band')} strokeWidth="52" />
          <circle cx="0" cy="0" r="156" fill="none" stroke={url('face-gloss')} strokeWidth="27" />
          <circle cx="0" cy="0" r="192" fill="none" stroke="#ffd75a" strokeWidth="5" opacity="0.82" />
          <circle cx="0" cy="0" r="120" fill="none" stroke="#fff0a0" strokeWidth="6" opacity="0.84" />
          <g className="ring-icon__glint-a">
            <circle
              cx="0" cy="0" r="156" fill="none" stroke="#fffde8" strokeWidth="13"
              strokeLinecap="round" pathLength="100" strokeDasharray="7 93"
              transform="rotate(-38)" opacity="0.92"
            />
            <circle cx="148" cy="0" r="9" fill="#fffef0" opacity="0.9" />
          </g>
          {/* Used after each edge-on crossing so the light stays screen-right. */}
          <g className="ring-icon__glint-b" opacity="0">
            <circle
              cx="0" cy="0" r="156" fill="none" stroke="#fffde8" strokeWidth="13"
              strokeLinecap="round" pathLength="100" strokeDasharray="7 93"
              transform="rotate(-142)" opacity="0.92"
            />
            <circle cx="-148" cy="0" r="9" fill="#fffef0" opacity="0.9" />
          </g>
        </g>
      </defs>

      <g transform="translate(256 256)" filter={url('ring-shadow')}>
        {/*
          Each slice follows x = z*sin(theta) while every face follows
          x = x*cos(theta); together an orthographic 3D extrusion.
        */}
        {SLICE_DEPTHS.map((amp) => (
          <g key={amp} color="#a93422" className="ring-icon__slice" style={{ '--amp': `${amp}px` }}>
            <g className="ring-icon__plane"><use href={`#${id('depth-slice')}`} /></g>
          </g>
        ))}

        {/* Smooths the silhouette only at the two exact edge-on poses. */}
        <rect className="ring-icon__edge-core" x="-17" y="-204" width="34" height="408" rx="17" fill="#a93422" opacity="0" />

        {/* The decorated face sits at the front of the 28px extrusion. */}
        <g className="ring-icon__slice" style={{ '--amp': `${FACE_DEPTH}px` }}>
          <g className="ring-icon__plane"><use href={`#${id('gold-face')}`} /></g>
        </g>
      </g>

      {/* The flashes coincide with the two edge-on moments. */}
      <g transform="translate(289 256)">
        <path
          className="ring-icon__sparkle-a"
          d="M0-42C4-12 12-4 42 0 12 4 4 12 0 42-4 12-12 4-42 0-12-4-4-12 0-42Z"
          fill="#fffef2" stroke="#ffe778" strokeWidth="1.5"
        />
      </g>
      <g transform="translate(223 256)">
        <path
          className="ring-icon__sparkle-b"
          d="M0-42C4-12 12-4 42 0 12 4 4 12 0 42-4 12-12 4-42 0-12-4-4-12 0-42Z"
          fill="#fffef2" stroke="#ffe778" strokeWidth="1.5"
        />
      </g>
    </svg>
  );
}
