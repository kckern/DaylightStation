import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  listYamlFiles, loadYaml, saveYaml, resolveYamlPath, getStats,
} from '#system/utils/FileIO.mjs';
import { DOCUMENT_SOURCE_SCHEMA } from '#domains/school/documents/documentSource.mjs';
import { DOCUMENT_V2_SCHEMA } from '#domains/school/documents/documentV2.mjs';

/** Default `io.stat`: mtime of whichever extension (.yml/.yaml) the basePath resolves to, or null when missing. */
function statBase(basePath) {
  const resolved = resolveYamlPath(basePath);
  return resolved ? getStats(resolved) : null;
}

/**
 * Reads print-ready document YAML files (v1 or v2 envelope, spec §4.1).
 *
 * TWO ROOTS, ONE REPOSITORY. A print document has a CLASS (the hand-authored
 * source someone edits) and OBJECTS (the immutable published revisions minted
 * from it). Those are different kinds of thing and no longer share a tree:
 *
 *   `sourceDirectory`  — the authored CLASSES, on the School catalog shelf
 *                        (`content/school/learning-catalog/documents/`), beside the
 *                        `school.learning-document/v1` files. `list()`/`get()`.
 *   `directory`        — the ARTIFACT root (`household/school/artifacts/print/`),
 *                        parent of `documents/`, `cards/` and `forms/`.
 *                        `getPublished()`/`getDerivedBank()`/
 *                        `writePublished()`, and `YamlAllocationStore`'s root.
 *
 * SOURCE DISCOVERY IS POSITIVE, BY SCHEMA. The catalog shelf is SHARED with
 * the learning-document system, so "every YAML file here is mine" is no longer
 * true: a file counts as a print-document source only when its parsed `schema`
 * is one this system owns (`school.document-source/v1` or
 * `school.document/v2`). A `school.learning-document/v1` file sitting in the
 * same folder is skipped outright — it carries `documentId`, not `id`, so the
 * old filename fallback below would otherwise have admitted it under a FAKE id
 * (its own file path) and let `get('arts/…')` resolve to something that is not
 * a print document at all. The reverse direction needs no guard:
 * `YamlLearningContentRepository#find` matches on `documentId`, which a print
 * source never has.
 *
 * WHY `school.document/v2` COUNTS TOO, even though `published/` is full of
 * them: v2 is a legal HAND-AUTHORED envelope, not only a publish output —
 * `validateAnyDocument` accepts one, `RenderPrintDocument` renders one, and
 * the CLI documents rendering one. Excluding it would make an authored v2
 * class unreachable by id. Published artifacts do not leak in through this
 * door because they live under the ARTIFACT root, which is a different
 * directory (and, on the legacy single-root path below, is excluded by name).
 *
 * LEGACY SINGLE-ROOT FALLBACK: constructing with `directory` alone (no
 * `sourceDirectory`) keeps the ORIGINAL negative-space rule — walk the
 * artifact root recursively, treat everything outside `#ARTIFACT_DIRS` as a
 * source, no schema filter. That is what keeps a not-yet-reconfigured
 * deployment (and the CLI's `--content-root`-only invocations) finding its
 * documents instead of silently finding zero, and it is the only path on
 * which a schema-less legacy v1 document is still discoverable.
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
 * repository's job — two sibling directories under the ARTIFACT `directory`
 * root (which the sources no longer share):
 *
 *   <directory>/documents/<id>/<rev>/document.yml  (always written)
 *   <directory>/documents/<id>/<rev>/answers.yml   (only when a bank exists)
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
  #directory; #sourceDirectory; #io;

  /**
   * @param {object} args
   * @param {string} args.directory - the ARTIFACT root (`documents/`,
   *   `cards/`, `forms/` hang off it). Required.
   * @param {string|null} [args.sourceDirectory] - the authored-source root.
   *   Singular, not a `sourceDirectories` array (which would match
   *   `YamlLearningContentRepository`'s `documentDirectories`): `list()`
   *   returns each entry's `file` as a path relative to ONE root and
   *   `#ARTIFACT_DIRS` is likewise a one-root exclusion, so a multi-root
   *   variant would need a different return shape, not just a loop. Omitted
   *   (or null) selects the legacy single-root behaviour — see the class doc.
   */
  constructor({ directory, sourceDirectory = null, io = {} } = {}) {
    if (typeof directory !== 'string' || directory.trim().length === 0) {
      throw new Error('YamlPrintDocumentRepository requires a non-empty directory');
    }
    if (sourceDirectory !== null && sourceDirectory !== undefined
        && (typeof sourceDirectory !== 'string' || sourceDirectory.trim().length === 0)) {
      throw new Error('YamlPrintDocumentRepository sourceDirectory must be a non-empty string when given');
    }
    this.#directory = directory;
    this.#sourceDirectory = sourceDirectory ?? null;
    this.#io = {
      list: io.list ?? listYamlFiles,
      load: io.load ?? loadYaml,
      save: io.save ?? saveYaml,
      stat: io.stat ?? statBase,
    };
  }

  /** Artifact subtrees that are never source documents, whichever root they turn up under. */
  static #ARTIFACT_DIRS = new Set(['documents', 'cards', 'forms', 'published', 'derived-banks', 'allocations']);

  /** Schemas this system owns. A file on the shared catalog shelf is a source iff it declares one. */
  static #SOURCE_SCHEMAS = new Set([DOCUMENT_SOURCE_SCHEMA, DOCUMENT_V2_SCHEMA]);

  /**
   * @returns {Array<{id: string, file: string, document: *}>} one entry per
   *   source YAML file in the source tree (hierarchical ids nest their source
   *   files, e.g. `arts/creature-identification/quiz-1.yml`), sorted by
   *   relative path. `document` is the raw parsed content (or null on a parse
   *   failure).
   *
   *   With a `sourceDirectory` configured this walks THAT root and admits only
   *   files whose `schema` this system owns — the catalog shelf is shared with
   *   the learning-document system, so co-resident
   *   `school.learning-document/v1` files are skipped rather than admitted
   *   under a fabricated id. Without one it walks the artifact root and admits
   *   everything outside `#ARTIFACT_DIRS` (legacy behaviour, class doc above).
   */
  list() {
    const root = this.#sourceDirectory ?? this.#directory;
    const schemaFiltered = this.#sourceDirectory !== null;
    const files = [...this.#io.list(root, { recursive: true })]
      .filter((relative) => !YamlPrintDocumentRepository.#ARTIFACT_DIRS.has(relative.split('/')[0]))
      .sort();
    const entries = [];
    for (const relative of files) {
      const raw = this.#io.load(path.join(root, relative));
      if (schemaFiltered && !YamlPrintDocumentRepository.#SOURCE_SCHEMAS.has(raw?.schema)) continue;
      // A source-schema file with no usable `id` still SHOWS UP, under its
      // filename, so authoring diagnostics can see it — `RenderPrintDocument`
      // rejects it at validation time anyway. That fallback is safe here
      // precisely because the schema filter already proved the file is ours.
      // An UNPARSABLE file (`load` -> null) is the one diagnostic the shared
      // shelf costs us: nothing distinguishes a broken print source from a
      // broken learning document, so it is dropped rather than guessed at.
      // `school-docs validate <dir>` is the authoring diagnostic that still
      // reports it — it walks files, not schemas, and surfaces parse errors.
      const id = typeof raw?.id === 'string' && raw.id.trim().length > 0 ? raw.id : relative;
      entries.push({ id, file: relative, document: raw });
    }
    return entries;
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
    const dir = path.join(this.#directory, 'documents', id);
    if (rev !== undefined && rev !== null) {
      return this.#io.load(path.join(dir, rev, 'document'));
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
    return this.#io.load(path.join(this.#directory, 'documents', id, rev, 'answers'));
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
      path.join(this.#directory, 'documents', document.id, rev, 'document'), document,
    );
    const bankResult = bank
      ? this.#writeArtifact(path.join(this.#directory, 'documents', document.id, rev, 'answers'), bank)
      : null;
    return { document: docResult, bank: bankResult };
  }

  /** Most-recent document revision under one document id — see `getPublished`. */
  #latestRevFile(dir, id) {
    const candidates = [...this.#io.list(dir, { recursive: true })]
      .filter((name) => name.endsWith('/document') || name.endsWith(`${path.sep}document`))
      .map((name) => name.split(/[\\/]/)[0]);
    let best = null;
    let bestMtime = -Infinity;
    for (const name of candidates) {
      const stat = this.#io.stat(path.join(dir, name, 'document'));
      const mtime = stat?.mtimeMs ?? -Infinity;
      if (mtime >= bestMtime) { bestMtime = mtime; best = name; }
    }
    return best ? path.join(best, 'document') : null;
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
