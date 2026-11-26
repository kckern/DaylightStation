import { readTextFromPath } from '#system/utils/FileIO.mjs';

export function readAccessInventoryEvidence(filePath) {
  return filePath ? JSON.parse(readTextFromPath(filePath)) : {};
}
