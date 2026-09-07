import { foodDensity } from '@shared-contracts/health/foodDensity.mjs';
import { useHealthDisplayPreferences } from '../display/HealthDisplayPreferences.jsx';
import { densityPresentation } from './densityPresentation.js';
import { PortionControl } from './PortionControl.jsx';
import { usePortionControl } from './usePortionDraft.js';

export function DensityBadge({ row, className = '', editRow = null }) {
  const control = usePortionControl();
  const { densityLevels } = useHealthDisplayPreferences();
  const presentation = densityPresentation(foodDensity(row), densityLevels);
  const classes = `health-density-badge ${className}`.trim();
  if (!presentation) return <span className={classes}
    aria-label="Density unavailable: known gram mass and calories are required"
    title="Density unavailable because gram mass or calories are unknown">
    <span className="health-density-badge__visual health-density-badge__visual--unavailable">—</span>
  </span>;
  if (editRow && control) return <PortionControl row={editRow} field="density" className={classes}>
    <span className="health-density-badge__visual" style={{ backgroundColor: presentation.color }} title={presentation.label}>{presentation.marker}</span>
  </PortionControl>;
  return <span className={classes} aria-label={presentation.label} title={presentation.label}
  ><span className="health-density-badge__visual" style={{ backgroundColor: presentation.color }}>{presentation.marker}</span></span>;
}
