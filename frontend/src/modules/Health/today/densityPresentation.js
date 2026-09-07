import { densityBracket } from '@shared-contracts/health/foodDensity.mjs';
import { DEFAULT_DENSITY_LEVELS } from '@shared-contracts/health/densityLevels.mjs';

const COLORS = ['#7fbddf', '#71cfc1', '#87ce95', '#bbd37c', '#edd477', '#eda461', '#dd795e', '#c44859', '#861e3f']; // data-color: approved density ladder palette
const valueLabel = value => Number(value.toFixed(2)).toString();

export function densityPresentation(value, levels = DEFAULT_DENSITY_LEVELS) {
  const bracket = densityBracket(value, levels);
  if (!bracket) return null;
  const nearest = bracket.fraction >= 0.5 ? bracket.upper : bracket.lower;
  const color = COLORS[levels.indexOf(nearest)] ?? COLORS.at(-1);
  const relation = bracket.outside === 'below' ? `Below ${bracket.lower.label}`
    : bracket.outside === 'above' ? `Above ${bracket.upper.label}`
      : bracket.lower === bracket.upper ? bracket.lower.label
        : `Between ${bracket.lower.label} and ${bracket.upper.label}`;
  const marker = value.toFixed(1);
  return { color, marker, label: `${relation} · ${valueLabel(value)} kcal/g` };
}
