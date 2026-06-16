// Decide whether a menu `display` selection targets the ArtMode scene
// (an `art:<preset>` id) vs the generic Displayer overlay.
// Returns the art scene id, or null for ordinary display content.
export function artSceneIdFromDisplay(display) {
  const id = display?.contentId || display?.id;
  return (id && String(id).startsWith('art:')) ? id : null;
}

export default artSceneIdFromDisplay;
