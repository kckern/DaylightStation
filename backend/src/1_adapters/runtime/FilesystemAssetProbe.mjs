import { fileExists } from '#system/utils/FileIO.mjs';
export class FilesystemAssetProbe { exists = (assetPath) => fileExists(assetPath); }
