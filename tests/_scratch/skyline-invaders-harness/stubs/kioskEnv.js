// Harness-only: `?kiosk=1` behaves like the garage kiosk (school-day gate and
// fingerprint prompt on); without it the page is a developer's machine.
const kiosk = new URLSearchParams(location.search).has('kiosk');
export const isKioskEnv = () => kiosk;
export const isLocalDevHost = () => !kiosk;
export default isKioskEnv;
