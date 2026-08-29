import path from 'node:path';
import { fileExists, readBinaryFromPath } from '#system/utils/FileIO.mjs';

/** Reads legacy worksheet PDFs without exposing their storage layout upstream. */
export class FilesystemWorksheetPdfReader {
  constructor({ rootDir }) { this.rootDir = rootDir; }

  read(file) {
    const resolved = path.join(this.rootDir, path.basename(String(file)));
    if (!fileExists(resolved)) return null;
    const pdf = readBinaryFromPath(resolved);
    const pageCount = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length || 1;
    return { pdf, pageCount };
  }
}

export default FilesystemWorksheetPdfReader;
