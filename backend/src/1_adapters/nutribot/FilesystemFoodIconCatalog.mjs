import { readDirectory } from '#system/utils/FileIO.mjs';

/** Discovers the food-icon slugs available to the NutriBot prompt. */
export class FilesystemFoodIconCatalog {
  constructor({ iconDir }) { this.iconDir = iconDir; }

  list() {
    return readDirectory(this.iconDir)
      .filter((file) => file.endsWith('.png'))
      .map((file) => file.replace('.png', ''))
      .sort();
  }
}

export default FilesystemFoodIconCatalog;
