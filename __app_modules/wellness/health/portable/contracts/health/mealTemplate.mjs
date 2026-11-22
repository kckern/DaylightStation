/** Whether an edited template component has a name and an optional positive weight. */
export function isValidTemplateComponent(component) {
  if (typeof component?.name !== 'string' || !component.name.trim()) return false;
  const grams = component.grams;
  return grams == null || grams === '' || Number(grams) > 0;
}
