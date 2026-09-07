import { densityBracket } from '@shared-contracts/health/foodDensity.mjs';
import { DEFAULT_DENSITY_LEVELS } from '@shared-contracts/health/densityLevels.mjs';

const COLORS = ['#7fbddf', '#71cfc1', '#87ce95', '#bbd37c', '#edd477', '#eda461', '#dd795e', '#c44859', '#861e3f']; // data-color: approved density ladder palette
const channel = (hex, start) => Number.parseInt(hex.slice(start, start + 2), 16);
const blend = (from, to, fraction) => `#${[1, 3, 5].map(start => Math.round(channel(from, start) + ((channel(to, start) - channel(from, start)) * fraction)).toString(16).padStart(2, '0')).join('')}`;
const valueLabel = value => Number(value.toFixed(2)).toString();

export function densityPresentation(value, levels = DEFAULT_DENSITY_LEVELS) {
  const bracket = densityBracket(value, levels);
  if (!bracket) return null;
  const lowerIndex = levels.indexOf(bracket.lower);
  const upperIndex = levels.indexOf(bracket.upper);
  const color = blend(COLORS[lowerIndex] ?? COLORS[0], COLORS[upperIndex] ?? COLORS.at(-1), bracket.fraction);
  const relation = bracket.outside === 'below' ? `Below ${bracket.lower.label}`
    : bracket.outside === 'above' ? `Above ${bracket.upper.label}`
      : bracket.lower === bracket.upper ? bracket.lower.label
        : `Between ${bracket.lower.label} and ${bracket.upper.label}`;
  const marker = bracket.outside === 'below' ? `↓${bracket.lower.level}`
    : bracket.outside === 'above' ? `↑${bracket.upper.level}`
      : bracket.lower === bracket.upper ? `${bracket.lower.level}`
        : `${bracket.lower.level}–${bracket.upper.level}`;
  return { color, marker, label: `${relation} · ${valueLabel(value)} kcal/g` };
}
