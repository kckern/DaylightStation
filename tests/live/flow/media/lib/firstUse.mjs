// Journeys that are not about naming a device mark the first-use popover answered
// before the page loads — a fresh browser would otherwise open it over the header
// and the top of Home (it is a real overlay: it intercepts pointer events under it).
// Journeys about the first-use moment itself (house-view, p0-accessibility) do not use this.
export async function markFirstUseDone(target) {
  await target.addInitScript(() => {
    try { if (!localStorage.getItem('media-app.first-use-done')) localStorage.setItem('media-app.first-use-done', 'journey'); } catch { /* storage unavailable */ }
  });
}
