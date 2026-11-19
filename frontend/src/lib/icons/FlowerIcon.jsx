/**
 * FlowerIcon: a passage that is partway there. It sits between TomatoIcon (not
 * started) and CoinIcon (silver, then gold) wherever a piano passage shows its
 * state: the crowd throws tomatoes, then flowers, then coins.
 *
 * Art: supplied by the owner (likely SVG Repo; source and licence to be
 * confirmed). Changes: none to the geometry or the fills. The one path at 10%
 * opacity is the artwork's own shading, not a state.
 *
 * Same conventions as CoinIcon and TomatoIcon: `size` sets width and height,
 * `label` makes it an image with a <title> (otherwise it is decorative), and
 * the only id is that title's, from useId.
 */
import { useId } from 'react';

export default function FlowerIcon({ size = '1em', label = null, className = '' }) {
  const titleId = `flower-${useId().replace(/[^a-zA-Z0-9]/g, '')}-title`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 511.844 511.844"
      className={`flower-icon${className ? ` ${className}` : ''}`}
      {...(label
        ? { role: 'img', 'aria-labelledby': titleId }
        : { 'aria-hidden': 'true', focusable: 'false' })}
    >
      {label && <title id={titleId}>{label}</title>}
      <g>
      <rect x="272.445" y="279.756" transform="matrix(-0.7837 -0.6211 0.6211 -0.7837 288.8991 796.3973)" fill="#8CC153" width="21.326" height="136.287"/>
      <polygon fill="#8CC153" points="171.417,387.898 190.817,379.026 247.503,502.972 228.118,511.844"/>
      <path fill="#8CC153" d="M238.771,287.881c0,5.889-4.78,10.669-10.653,10.669c-5.904,0-10.668-4.78-10.668-10.669 s4.764-10.668,10.668-10.668C233.991,277.213,238.771,281.992,238.771,287.881z"/>
      <path fill="#8CC153" d="M260.108,330.556c0,5.889-4.779,10.653-10.667,10.653c-5.889,0-10.669-4.765-10.669-10.653 s4.78-10.669,10.669-10.669C255.329,319.887,260.108,324.667,260.108,330.556z"/>
      <path fill="#8CC153" d="M238.771,373.199c0,5.889-4.78,10.668-10.653,10.668c-5.904,0-10.668-4.779-10.668-10.668 s4.764-10.669,10.668-10.669C233.991,362.53,238.771,367.311,238.771,373.199z"/>
      <path fill="#8CC153" d="M260.108,415.858c0,5.889-4.779,10.653-10.667,10.653c-5.889,0-10.669-4.765-10.669-10.653 s4.78-10.668,10.669-10.668C255.329,405.19,260.108,409.969,260.108,415.858z"/>
      </g>
      <rect x="228.122" y="245.912" fill="#A0D468" width="21.322" height="265.92"/>
      <path fill="#EC5564" d="M366.733,76.774c0,70.666-59.654,179.133-130.32,179.133S110.81,147.44,110.81,76.774 S165.747,0,236.413,0C307.078,0,366.733,6.108,366.733,76.774z"/>
      <path fill="#D94452" d="M115.59,45.471c2.827,1.249,6.623,1.921,10.185,4.232c82.35,53.453,145.425-28.288,239.302,8.232 C355.018,4.983,300.205,0,236.413,0C178.024,0,130.398,4.171,115.59,45.471z"/>
      <g>
      <path fill="#A0D468" d="M312.639,305.548c77.789,26.991,113.605-116.371,113.605-116.371 C325.916,206.546,301.221,301.58,312.639,305.548z"/>
      <path fill="#A0D468" d="M267.137,371.168c37.879,60.092,112.779-19.713,112.779-19.713 C277.229,292.411,259.826,359.578,267.137,371.168z"/>
      <path fill="#A0D468" d="M194.285,405.768c-93.003,8.2-108.686-142.551-108.686-142.551 C195.284,285.538,207.953,404.549,194.285,405.768z"/>
      <path fill="#A0D468" d="M217.809,465.951c-51.141,49.298-95.502-40.643-95.502-40.643 C224.51,393.631,227.681,456.424,217.809,465.951z"/>
      </g>
      <path fill="#D94452" d="M110.841,76.055h22.415V42.3h-16.417C112.997,51.453,110.904,62.559,110.841,76.055z"/>
      <path opacity="0.1" d="M247.097,255.078c18.073-2.765,35.224-12.387,50.624-26.272 c17.277-46.627,18.824-128.633-54.951-164.294c-67.089-32.428-110.622-32.99-110.622,12.262 C132.148,143.847,181.632,244.972,247.097,255.078z"/>
      <path fill="#F9677C" d="M221.448,64.512C154.36,32.084,110.81,31.522,110.81,76.774c0,70.666,54.937,179.133,125.603,179.133 c10.215,0,20.197-2.265,29.802-6.357C290.85,212.233,308.094,106.405,221.448,64.512z"/>
    </svg>
  );
}
