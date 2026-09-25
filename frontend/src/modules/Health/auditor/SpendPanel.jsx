import { useState } from 'react';
import { Stack, Table, Text } from '@mantine/core';
import { SectionCard, LoadingState, ErrorState, EmptyState } from '../../../lib/ui';
import { formatUsd, triggerLabel } from './auditorFormat.js';

// Chart geometry in viewBox units; the SVG scales to its container's width.
const W = 320, H = 132, LEFT = 34, RIGHT = 4, TOP = 14, BOTTOM = 18, GAP = 2, RADIUS = 4;
const PLOT_W = W - LEFT - RIGHT, PLOT_H = H - TOP - BOTTOM;

const shortDate = iso => new Date(`${iso}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const dayText = day => `${shortDate(day.date)}: ${formatUsd(day.costUsd, 2)} · ${plural(day.runs, 'run')} · ${day.changed} changed`;

/** A column rising from the baseline: 4px rounded top, square foot. */
function barPath(x, width, top, baseline) {
  const r = Math.min(RADIUS, width / 2, baseline - top);
  return `M${x},${baseline} V${top + r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${baseline} Z`;
}

function DailyChart({ days, capUsd, summary }) {
  const [active, setActive] = useState(null);
  const max = Math.max(...days.map(day => day.costUsd), capUsd ?? 0) || 1;
  const y = value => TOP + PLOT_H - (value / (max * 1.08)) * PLOT_H;
  const baseline = TOP + PLOT_H;
  const slot = PLOT_W / days.length;
  const barW = Math.min(24, slot - GAP);
  const peak = Math.max(...days.map(day => day.costUsd));
  return <Stack gap={4}>
    <Text size="sm" role="status" className="health-auditor-spend__readout">
      {active == null ? 'Tap or focus a bar to read that day.' : dayText(days[active])}
    </Text>
    <svg className="health-auditor-spend__chart" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`Daily auditor cost, last 30 days. ${summary}`}
      onMouseLeave={() => setActive(null)}>
      <line className="health-auditor-spend__axis" x1={LEFT} x2={W - RIGHT} y1={baseline} y2={baseline} />
      <text className="health-auditor-spend__tick" x={LEFT - 4} y={baseline} textAnchor="end" dominantBaseline="middle">$0</text>
      <text className="health-auditor-spend__tick" x={LEFT - 4} y={y(peak)} textAnchor="end" dominantBaseline="middle">{formatUsd(peak, 2)}</text>
      {days.map((day, i) => {
        const x = LEFT + i * slot + (slot - barW) / 2;
        return <g key={day.date}>
          {day.costUsd > 0 ? <path className={`health-auditor-spend__bar${active === i ? ' is-active' : ''}`} d={barPath(x, barW, y(day.costUsd), baseline)} /> : null}
          <rect className="health-auditor-spend__slot" x={LEFT + i * slot} y={TOP} width={slot} height={PLOT_H} tabIndex={0} role="button"
            aria-label={dayText(day)} onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} onClick={() => setActive(i)} />
        </g>;
      })}
      {capUsd != null ? <g className="health-auditor-spend__cap" aria-hidden="true">
        <line x1={LEFT} x2={W - RIGHT} y1={y(capUsd)} y2={y(capUsd)} />
        <text x={W - RIGHT} y={y(capUsd) - 3} textAnchor="end">Cap {formatUsd(capUsd, 2)}</text>
      </g> : null}
      <text className="health-auditor-spend__tick" x={LEFT} y={H - 4}>{shortDate(days[0].date)}</text>
      <text className="health-auditor-spend__tick" x={W - RIGHT} y={H - 4} textAnchor="end">{shortDate(days.at(-1).date)}</text>
    </svg>
  </Stack>;
}

function CostTable({ label, first, rows }) {
  return <Table.ScrollContainer minWidth={280}>
    <Table aria-label={label} className="health-auditor-spend__table">
      <Table.Thead><Table.Tr><Table.Th>{first}</Table.Th><Table.Th>Runs</Table.Th><Table.Th>Avg / run</Table.Th><Table.Th>Total</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{rows.map(row => <Table.Tr key={row.key}>
        <Table.Td>{row.label}</Table.Td><Table.Td>{row.runs}</Table.Td><Table.Td>{formatUsd(row.avgUsd)}</Table.Td><Table.Td>{formatUsd(row.costUsd, 2)}</Table.Td>
      </Table.Tr>)}</Table.Tbody>
    </Table>
  </Table.ScrollContainer>;
}

/** Auditor spend over the last 30 days, and what a run costs by trigger and model. `spend` is useAuditorSpend's resource. */
export function SpendPanel({ spend }) {
  if (!spend.data) return spend.error ? <ErrorState error={spend.error} onRetry={spend.reload} label="Auditor spend" /> : <LoadingState label="Auditor spend" />;
  const { days = [], capUsd = null, byTrigger = [], byModel = [] } = spend.data;
  const runs = days.reduce((sum, day) => sum + day.runs, 0);
  if (!runs) return <SectionCard title="Spend"><EmptyState title="No auditor runs in the last 30 days" /></SectionCard>;
  const total = days.reduce((sum, day) => sum + day.costUsd, 0);
  const peak = days.reduce((best, day) => (day.costUsd > best.costUsd ? day : best), days[0]);
  const summary = `Last 30 days: ${formatUsd(total, 2)} over ${plural(runs, 'run')}. Highest day: ${shortDate(peak.date)}, ${formatUsd(peak.costUsd, 2)}.`;
  return <SectionCard title="Spend">
    <Stack gap="sm">
      <Text size="sm">{summary}</Text>
      <DailyChart days={days} capUsd={capUsd} summary={summary} />
      <details><summary>Daily figures</summary>
        <Table.ScrollContainer minWidth={280}><Table aria-label="Daily auditor cost">
          <Table.Thead><Table.Tr><Table.Th>Day</Table.Th><Table.Th>Cost</Table.Th><Table.Th>Runs</Table.Th><Table.Th>Changed</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{[...days].reverse().map(day => <Table.Tr key={day.date}>
            <Table.Td>{shortDate(day.date)}</Table.Td><Table.Td>{formatUsd(day.costUsd, 2)}</Table.Td><Table.Td>{day.runs}</Table.Td><Table.Td>{day.changed}</Table.Td>
          </Table.Tr>)}</Table.Tbody>
        </Table></Table.ScrollContainer>
      </details>
      <Text fw={600} size="sm">Cost per run</Text>
      <CostTable label="Cost per run by trigger" first="Trigger"
        rows={byTrigger.map(row => ({ key: row.trigger, label: triggerLabel(row.trigger), runs: row.runs, avgUsd: row.avgUsd, costUsd: row.costUsd }))} />
      <CostTable label="Cost per run by model" first="Model"
        rows={byModel.map(row => ({ key: row.model, label: row.model, runs: row.runs, avgUsd: row.avgUsd, costUsd: row.costUsd }))} />
    </Stack>
  </SectionCard>;
}

export default SpendPanel;
