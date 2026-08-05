import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  listYamlFiles, loadYaml, saveYaml, resolveYamlPath, getStats,
} from '#system/utils/FileIO.mjs';

/** Default `io.stat`: mtime of whichever extension (.yml/.yaml) the basePath resolves to, or null when missing. */
function statBase(basePath) {
  const resolved = resolveYamlPath(basePath);
  return resolved ? getStats(resolved) : null;
}

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
 *
 * PUBLISH ARTIFACTS (Task 5, spec §3/§4.3): `publishDocument` (domain layer,
 * pure) splits a `school.document-source/v1` into an answer-free published
 * document + a derived question bank. Persisting that pair is this
 * repository's job — two flat, non-recursive sibling directories under the
 * SAME `directory` root as the hand-authored sources:
 *
 *   <directory>/published/<id>@<rev>.yml       (always written)
 *   <directory>/derived-banks/<id>@<rev>.yml    (written only when a bank exists)
 *
 * APPEND-ONLY (spec §4.3 "prior revisions are retained"): `rev` is a content
 * hash of the validated source (`documentSource.mjs`'s `computeRev`), so two
 * writes at the same `<id>@<rev>` path can only ever legitimately carry
 * IDENTICAL content — republishing an unchanged source is idempotent-ok
 * (`writePublished` no-ops), but a rev colliding with DIFFERENT content would
 * mean two different sources hashed to the same rev (or a hand-edited
 * artifact) and is refused outright rather than silently overwritten.
 */
export class YamlPrintDocumentRepository {
  #directory; #io;

  constructor({ directory, io = {} } = {}) {
    if (typeof directory !== 'string' || directory.trim().length === 0) {
      throw new Error('YamlPrintDocumentRepository requires a non-empty directory');
    }
    this.#directory = directory;
    this.#io = {
      list: io.list ?? listYamlFiles,
      load: io.load ?? loadYaml,
      save: io.save ?? saveYaml,
      stat: io.stat ?? statBase,
    };
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

  /**
   * @param {string} id
   * @param {string} [rev] - a specific revision; omitted picks the LATEST
   *   published revision for `id` (most recent write, by file mtime — revs
   *   are content hashes with no inherent ordering, so mtime is the only
   *   available "most recently published" signal without a separate index).
   * @returns {*|null} the raw parsed published document, or null when none exists.
   */
  getPublished(id, rev) {
    const dir = path.join(this.#directory, 'published');
    if (rev !== undefined && rev !== null) {
      return this.#io.load(path.join(dir, `${id}@${rev}`));
    }
    const latest = this.#latestRevFile(dir, id);
    return latest ? this.#io.load(path.join(dir, latest)) : null;
  }

  /**
   * @param {string} id
   * @param {string} rev - required: a derived bank only ever exists for one
   *   exact published revision, never "latest" (a caller that has a published
   *   document already has its `rev` in hand).
   * @returns {*|null} the raw parsed derived question bank, or null when this
   *   revision minted no bank (a purely presentational source) or doesn't exist.
   */
  getDerivedBank(id, rev) {
    if (typeof rev !== 'string' || rev.trim().length === 0) {
      throw new Error('getDerivedBank requires a rev');
    }
    return this.#io.load(path.join(this.#directory, 'derived-banks', `${id}@${rev}`));
  }

  /**
   * Persists the publish transform's output pair (`documentSource.mjs`'s
   * `publishDocument`). Append-only: writing the SAME `<id>@<rev>` path twice
   * is only ever legal when the content is identical (idempotent no-op) —
   * different content at an existing path is refused, never overwritten.
   *
   * @param {{document: object, bank: object|null, rev: string}} args -
   *   `document` must carry `id`; `bank` is null for a source with no
   *   answer-bearing content (no derived-bank file is written in that case).
   * @returns {{document: {written: boolean, alreadyPublished: boolean},
   *   bank: {written: boolean, alreadyPublished: boolean}|null}}
   */
  writePublished({ document, bank, rev } = {}) {
    if (!document || typeof document.id !== 'string' || document.id.trim().length === 0) {
      throw new Error('writePublished requires document.id');
    }
    if (typeof rev !== 'string' || rev.trim().length === 0) {
      throw new Error('writePublished requires rev');
    }
    const docResult = this.#writeArtifact(
      path.join(this.#directory, 'published', `${document.id}@${rev}`), document,
    );
    const bankResult = bank
      ? this.#writeArtifact(path.join(this.#directory, 'derived-banks', `${document.id}@${rev}`), bank)
      : null;
    return { document: docResult, bank: bankResult };
  }

  /** Most-recent-mtime `<id>@*` entry under `dir` (published/ only) — see `getPublished`'s own doc comment. */
  #latestRevFile(dir, id) {
    // Hierarchical ids nest their artifacts (`published/<subject>/<course>/
    // <slug>@<rev>.yml`), so the listing happens in the id's own subdirectory
    // and candidates are re-prefixed back to dir-relative paths.
    const segments = id.split('/');
    const slug = segments.pop();
    const subdir = segments.length ? path.join(dir, ...segments) : dir;
    const relative = (name) => (segments.length ? path.join(...segments, name) : name);
    const prefix = `${slug}@`;
    const candidates = [...this.#io.list(subdir)]
      .filter((name) => name.startsWith(prefix))
      .map(relative);
    let best = null;
    let bestMtime = -Infinity;
    for (const name of candidates) {
      const stat = this.#io.stat(path.join(dir, name));
      const mtime = stat?.mtimeMs ?? -Infinity;
      if (mtime >= bestMtime) { bestMtime = mtime; best = name; }
    }
    return best;
  }

  /**
   * Write-once-per-path: identical content re-publishes as a no-op; different
   * content refuses.
   *
   * Compared through a JSON round-trip, not raw `isDeepStrictEqual`:
   * `existing` came back through a real save+load cycle (`saveYaml`'s
   * `js-yaml.dump` OMITS any key whose value is `undefined`), while `content`
   * is the in-memory object a domain function just built — which, for a
   * bank's optional fields (`questionBankValidation.mjs`'s
   * `unit`/`readalong`/`subject`), often carries those keys explicitly set to
   * `undefined` rather than omitted entirely. `isDeepStrictEqual` treats "own
   * property present, value undefined" as different from "property absent",
   * so re-publishing the byte-identical source used to be refused as a false
   * "different content" conflict on every second call. `JSON.stringify`
   * drops undefined-valued keys on both sides uniformly — the same
   * normalisation the YAML file itself already imposes on `existing`.
   */
  #writeArtifact(basePath, content) {
    const existing = this.#io.load(basePath);
    if (existing !== null && existing !== undefined) {
      const normalize = (value) => JSON.parse(JSON.stringify(value));
      if (isDeepStrictEqual(normalize(existing), normalize(content))) {
        return { written: false, alreadyPublished: true };
      }
      throw new Error(
        `refusing to overwrite published artifact at '${basePath}' with different content (append-only)`,
      );
    }
    this.#io.save(basePath, content);
    return { written: true, alreadyPublished: false };
  }
}

export default YamlPrintDocumentRepository;
