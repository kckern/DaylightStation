// autoAppVehicleLabel.js — vehicle display-label formatting for AutoApp.jsx,
// split out so Fast Refresh can hot-reload the app on its own.

/**
 * `2021 Chrysler Pacifica Touring L`, from the vehicle record's identity block.
 * Returns null rather than an empty string so callers can skip the element.
 */
export function describeVehicle(vehicle) {
  const id = vehicle?.identity || vehicle || {};
  const text = [id.year, id.make, id.model, id.series].filter(Boolean).join(' ');
  return text || null;
}
