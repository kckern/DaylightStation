export const BOARD_LAYOUTS = Object.freeze({
  SINGLE: 'single-centered',
  WIDE: 'single-wide',
  DUAL: 'dual-equal',
  PRIMARY_SECONDARY: 'primary-secondary',
});

export const ADDRESS_EVENTS = Object.freeze({
  ADDRESS: 'address',
  CONFIRM: 'confirm',
  CANCEL: 'cancel',
  HINT: 'hint',
});

export function boardAddress(value, source = 'midi') {
  return { type: ADDRESS_EVENTS.ADDRESS, value, source };
}
