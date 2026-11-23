import { Menu } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';
import { fitEffectToChannel } from '../../../../../shared/contracts/content-filter/cueModality.mjs';
import { actionKeysFor, effectButton, isSceneRow, keysKindOf, plays } from './reviewScope.js';

/**
 * The effect a part gets, as a menu (Fable design 2026-11-22, owner: "when I see the mute button, I
 * want to click it and switch it"): the effects that fit the part's channel, each with its key, the
 * current one checked. A menu, not a cycle: a cycle would save effects nobody chose on the way.
 * The list and the part card share it; the card adds its own items (`children`) below a divider.
 */
const SCENE_EFFECTS = new Set(['skip', 'blackout', 'off']);

/** [key, label, value] for the effects that fit this part as it is. */
export function effectOptions(row) {
  const all = actionKeysFor(keysKindOf(row));
  if (isSceneRow(row)) return all.filter(([, , v]) => SCENE_EFFECTS.has(v));
  const fits = (v) => v === 'off' || fitEffectToChannel(v, row?.modality, { hasRegions: true }) === v || fitEffectToChannel(v, row?.modality, { hasRegions: false }) === v;
  return all.filter(([, , v]) => fits(v));
}

/** Whether `value` is what the part does now. */
export const isCurrentEffect = (row, value) => (plays(row) ? value === 'off' : effectButton(row?.effect) === value);

export function EffectMenu({ row, target, onPick, opened, onChange, children = null, disabled = false, position = 'bottom-start' }) {
  const options = effectOptions(row);
  return (
    <Menu opened={opened} onChange={onChange} position={position} withinPortal shadow="md" width={220} disabled={disabled}
      returnFocus={false} trapFocus closeOnItemClick>
      <Menu.Target>{target}</Menu.Target>
      <Menu.Dropdown className="cf-fx-menu">
        <Menu.Label>Effect</Menu.Label>
        {options.map(([k, label, v]) => {
          const current = isCurrentEffect(row, v);
          return (
            <Menu.Item key={k} onClick={() => onPick?.(k.toLowerCase())} aria-checked={current} role="menuitem"
              leftSection={<span className="cf-fx-menu__check">{current ? <IconCheck size={14} /> : null}</span>}
              rightSection={<kbd className="cf-keybar__key">{k}</kbd>}>
              {label === 'Off' ? 'Let it play (off)' : label}
            </Menu.Item>
          );
        })}
        {children}
      </Menu.Dropdown>
    </Menu>
  );
}

export default EffectMenu;
