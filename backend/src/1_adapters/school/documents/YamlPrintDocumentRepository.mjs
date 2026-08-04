import path from 'node:path';
import { listYamlFiles, loadYaml } from '#system/utils/FileIO.mjs';

/**
 * Reads print-ready document YAML files (v1 or v2 envelope, spec §4.1) from a
 * single flat directory — mirrors the non-recursive directory-walk
 * conventions of `YamlSurfaceProfileRepository` (one document per file).
 *
 * ID RESOLUTION: a document's own `id` field is the authoritative identity —
 * both envelope generations already require it (`documentValidation.mjs`'s
 * `ID_PATTERN` check), and the rest of the School domain already references
 * documents by that same content id (`YamlLearningContentRepository#find`,
 * `unit.document`), never by filename. A file whose content has no `id` (or
 * failed to parse at all) falls back to its filename so it still SHOWS UP in
 * `list()` for authoring diagnostics — `RenderPrintDocument` rejects it at
 * validation time regardless, since `id` is required there too.
 *
 * Raw content only: parsing a file is as far as this repository goes.
 * Validating it (`validateAnyDocument`) is the consumer's (`RenderPrintDocument`)
 * job, exactly like `YamlLearningContentRepository` hands back raw documents
 * for `CurriculumAccess` to validate.
 */
export class YamlPrintDocumentRepository {
  #directory; #io;

  constructor({ directory, io = {} } = {}) {
    if (typeof directory !== 'string' || directory.trim().length === 0) {
      throw new Error('YamlPrintDocumentRepository requires a non-empty directory');
    }
    this.#directory = directory;
    this.#io = { list: io.list ?? listYamlFiles, load: io.load ?? loadYaml };
  }

  /**
   * @returns {Array<{id: string, file: string, document: *}>} one entry per
   *   YAML file in the directory, sorted by filename. `document` is the raw
   *   parsed content (or null when the file failed to parse).
   */
  list() {
    const files = [...this.#io.list(this.#directory)].sort();
    return files.map((relative) => {
      const raw = this.#io.load(path.join(this.#directory, relative));
      const id = typeof raw?.id === 'string' && raw.id.trim().length > 0 ? raw.id : relative;
      return { id, file: relative, document: raw };
    });
  }

  /**
   * @param {string} id
   * @returns {*|null} the raw parsed YAML for the document whose `id` field
   *   (or, for an id-less/unparsable file, filename) matches — null when none does.
   */
  get(id) {
    return this.list().find((entry) => entry.id === id)?.document ?? null;
  }
}

export default YamlPrintDocumentRepository;
