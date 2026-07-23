/**
 * Reusable clickable SVG asset. NOT map-specific — `asset` names any SVG in
 * ./assets/ (a US map, an anatomy diagram, a keyboard…). Regions (and any
 * callout pucks) carry `data-region-id`; a click or Enter/Space resolves the
 * id and calls onPick once until a verdict lands. On verdict, the picked
 * region is marked right/wrong and the expected region is always highlighted.
 * Delegated listener (one handler for the whole SVG) so it works regardless of
 * how many paths a region has.
 */
import { useEffect, useMemo, useRef } from 'react';
import getLogger from '../../../../lib/logging/Logger.js';

const ASSETS = import.meta.glob('./assets/*.svg', { eager: true, query: '?raw', import: 'default' });
const svgFor = (asset) => ASSETS[`./assets/${asset}.svg`] || null;

let _logger;
const logger = () => (_logger || (_logger = getLogger().child({ component: 'clickable-asset' })));

export default function ClickableAsset({ asset, value, verdict, expected, onPick }) {
  const ref = useRef(null);
  const svg = useMemo(() => svgFor(asset), [asset]);
  const locked = !!verdict;

  // Apply verdict/selection classes imperatively (the SVG is injected HTML).
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll('[data-region-id]').forEach((el) => {
      const id = el.getAttribute('data-region-id');
      el.classList.toggle('is-selected', !locked && id === value);
      el.classList.toggle('is-expected', locked && id === expected);
      el.classList.toggle('is-right', locked && verdict?.correct && id === value);
      el.classList.toggle('is-wrong', locked && verdict && !verdict.correct && id === value);
    });
  }, [value, verdict, expected, locked, svg]);

  const handle = (e) => {
    if (locked) return;
    const target = e.target.closest?.('[data-region-id]');
    if (!target) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const id = target.getAttribute('data-region-id');
    logger().debug('region-pick', { asset, id });
    onPick(id);
  };

  if (!svg) { logger().warn('asset-missing', { asset }); return null; }
  return (
    <div
      ref={ref}
      className={`school-clickable school-clickable--${asset}${locked ? ' is-locked' : ''}`}
      onClick={handle}
      onKeyDown={handle}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
