/**
 * Screens that exist without a household YAML file. A household file of the same id
 * replaces the built-in one (a household can restyle its ad-hoc screen).
 *
 * `adhoc`: any browser as a screen (`/screen/adhoc`, `/screen/adhoc/party-games/charades`,
 * `?open=`, `?play=`, `?name=MacBook`). Its device is `$browser`: the page puts its own
 * `browser:<token>` identity there, so remote commands reach that page alone, and it
 * announces itself (with its name) to the household's screen list while open.
 */
export const BUILT_IN_SCREENS = Object.freeze({
  adhoc: Object.freeze({
    screen: 'adhoc',
    name: 'Ad-hoc screen',
    route: '/screen/adhoc',
    websocket: { commands: true, publishState: true, guardrails: { device: '$browser' } },
    theme: {
      'screen-bg': '#10141c',
      'panel-bg': 'rgba(255, 255, 255, 0.04)',
      'panel-radius': '12px',
      'panel-padding': '1rem',
      'font-family': 'Roboto Condensed, sans-serif',
      'font-color': '#e6e9ef',
      'accent-color': '#4fc99a',
    },
    layout: {
      direction: 'column',
      gap: '1rem',
      children: [
        { widget: 'clock', grow: 0, shrink: 0 },
        { widget: 'screen-identity', grow: 1 },
      ],
    },
  }),
});

/** A fresh copy of a built-in screen's config, or null. */
export function builtInScreen(id) {
  const screen = BUILT_IN_SCREENS[id];
  return screen ? JSON.parse(JSON.stringify(screen)) : null;
}
