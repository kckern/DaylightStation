// Public entry for games that consume gaming-assets skins: validate a skin
// against the game's slot contract, and export it into the files the game
// loads. Everything else in gaming-assets/ is implementation.
export { buildSkinBrief, exportSkin, validateSkin } from './side-scroller.mjs';
