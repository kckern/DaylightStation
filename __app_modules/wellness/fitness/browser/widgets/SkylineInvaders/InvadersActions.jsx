import React, { useCallback, useRef, useState } from 'react';
import useMenuInput from './useMenuInput.js';
import useArmsWideHold from './useArmsWideHold.js';

const cls = (...names) => names.filter(Boolean).join(' ');

/**
 * Focus and input for one screen's list of actions. Every action is a button
 * on screen (touch), the focused one is pressed by Enter, any foot-pad key or
 * gamepad A, and the first action by holding both arms out to the sides.
 *
 * @param {object} options
 * @param {{ id: string, label: string, hint?: string, disabled?: boolean, onPress: function }[]} options.actions
 * @param {boolean} [options.active]            listen for input (false while a prompt covers the screen)
 * @param {'row'|'column'} [options.axis]       which arrow pair moves the focus
 * @param {function} [options.onOther]          hears the other arrow pair ('left' | 'right' | 'up' | 'down')
 * @param {function} [options.onBack]           Escape, Backspace, gamepad B
 * @param {object} [options.tracker]            aim tracker, for the arms-wide press of the first action
 * @returns {{ focused: number, hold: number, press: (index: number) => void }}
 */
export function useActionFocus({ actions, active = true, axis = 'row', onOther, onBack, tracker = null }) {
  const [wanted, setWanted] = useState(0);
  const enabled = actions.map((action, index) => (action.disabled ? -1 : index)).filter((index) => index >= 0);
  // The focus rests on an action that can be pressed, nearest the one asked for.
  const focused = enabled.includes(wanted) ? wanted : enabled.find((index) => index > wanted) ?? enabled[enabled.length - 1] ?? -1;
  const live = useRef({});
  live.current = { actions, enabled, focused, onOther, onBack };

  const press = useCallback((index) => {
    const action = live.current.actions[index];
    if (action && !action.disabled) action.onPress?.();
  }, []);

  useMenuInput(active, (action) => {
    const now = live.current;
    const [back, forward] = axis === 'row' ? ['left', 'right'] : ['up', 'down'];
    if (action === 'accept') press(now.focused);
    else if (action === 'back') now.onBack?.();
    else if (action === back || action === forward) {
      const at = now.enabled.indexOf(now.focused);
      const next = now.enabled[at + (action === forward ? 1 : -1)];
      if (next !== undefined) setWanted(next);
    } else now.onOther?.(action);
  });

  const first = actions[0];
  const hold = useArmsWideHold(tracker, active && !!first && !first.disabled, () => press(0));
  return { focused, hold, press };
}

/** One action as a button. `hold` (0..1) fills it while the arms-wide press is being held. */
export function ActionButton({ action, primary = false, focused = false, hold = 0, onPress }) {
  return (
    <button
      type="button"
      className={cls('skyline-invaders__action', primary && 'is-primary', focused && 'is-focused')}
      data-action={action.id}
      disabled={!!action.disabled}
      style={hold > 0 ? { '--si-hold': hold } : undefined}
      // A tapped button would keep the focus and take the next Space or Enter for itself.
      onClick={(event) => { event.currentTarget.blur(); onPress(); }}
    >
      <b>{action.label}</b>
      {action.hint && <small>{action.hint}</small>}
    </button>
  );
}

/** A row of actions with its own focus: the pause and result screens. The first action is the primary one. */
export default function InvadersActions({ actions, active = true, onBack, tracker = null, className = '' }) {
  const { focused, hold, press } = useActionFocus({ actions, active, axis: 'row', onBack, tracker });
  return (
    <div className={cls('skyline-invaders__actions', className)}>
      {actions.map((action, index) => (
        <ActionButton key={action.id} action={action} primary={index === 0} focused={index === focused} hold={index === 0 ? hold : 0} onPress={() => press(index)} />
      ))}
    </div>
  );
}
