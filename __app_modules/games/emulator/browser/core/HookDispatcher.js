/**
 * HookDispatcher — routes declarative emulator hooks to action handlers.
 *
 * Hooks are `{ on, do }` objects: `on` is the event id that triggers the hook,
 * `do` is a map of action-name → payload. On dispatch, each action whose name
 * has a registered handler is invoked with its payload. Unknown actions are
 * tolerated and routed to the `log` handler instead of throwing.
 */

/**
 * @param {{ handlers: Record<string, (payload: any) => void> }} deps
 * @returns {{ dispatch: (hooks: Array<{on: string, do: object}>|null, eventId: string) => void }}
 */
export function createHookDispatcher({ handlers }) {
  return {
    dispatch(hooks, eventId) {
      if (!Array.isArray(hooks) || hooks.length === 0) return;

      for (const hook of hooks) {
        if (!hook || hook.on !== eventId) continue;
        const actions = hook.do || {};
        for (const [action, payload] of Object.entries(actions)) {
          const handler = handlers[action];
          if (typeof handler === 'function') {
            handler(payload);
          } else {
            // Unknown action: stay tolerant, surface via log if available.
            handlers.log?.({ unknownAction: action, payload });
          }
        }
      }
    },
  };
}
