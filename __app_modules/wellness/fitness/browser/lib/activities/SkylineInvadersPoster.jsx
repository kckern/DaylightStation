// Session-history poster for Skyline Invaders rounds: a skyline, one invader
// on the 11 x 8 pixel grid the game draws with, and a shot on its way up.
const INVADER = [
  '..#.....#..',
  '...#...#...',
  '..#######..',
  '.##.###.##.',
  '###########',
  '#.#######.#',
  '#.#.....#.#',
  '...##.##...',
];
const PIXEL = 6;

export default function SkylineInvadersPoster(props) {
  return <svg viewBox="0 0 120 160" width="100%" height="100%" fill="currentColor" role="img" aria-label="Skyline Invaders round" {...props}>
    {INVADER.flatMap((row, y) => Array.from(row).map((cell, x) => (cell === '#'
      ? <rect key={`${x}-${y}`} x={27 + x * PIXEL} y={22 + y * PIXEL} width={PIXEL} height={PIXEL}/>
      : null)))}
    <rect x="57" y="84" width="6" height="22"/>
    <path d="M0 160v-34h18v-14h16v22h12v-30h20v38h14v-24h18v16h22v26Z" opacity=".35"/>
  </svg>;
}
