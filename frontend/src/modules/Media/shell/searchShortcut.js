/** True when a `/` keydown is not a request to open search (typing, modifiers, already handled). */
export function slashIsNotForSearch(e, active = document.activeElement) {
  if (e.key !== '/' || e.defaultPrevented) return true;
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  const tag = active?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!active?.isContentEditable;
}
