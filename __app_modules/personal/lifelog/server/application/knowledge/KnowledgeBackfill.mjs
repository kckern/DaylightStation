import { importDigest, validImportManifest } from '../../domain/knowledge/importManifest.mjs';
import { reduceKnowledge } from '../../domain/knowledge/reduceKnowledge.mjs';
import { localDateFor } from '../../domain/knowledge/calendar.mjs';
const fail = code => {
  throw Object.assign(new Error(code), {
    code
  });
};
const sourceDigest = messages => importDigest(messages.map(m => [m.ref, m.sourceHash]));
const project = (snapshot, batch) => ({
  ...snapshot,
  objects: {
    ...snapshot.objects,
    ...Object.fromEntries(batch.upserts.map(o => [o.id, o]))
  },
  state: {
    ...snapshot.state,
    ...batch.statePatch
  }
});

/** Bounded operator job. No provider, delivery, scheduler or conversational authority. */
export class KnowledgeBackfill {
  #store;
  #historical;
  #checkpoint;
  #extractor;
  #authority;
  #reserve;
  #clock;
  #timezone;
  #workContext;
  #closed = false;
  #running = new Map();
  constructor({
    knowledgeStore: store,
    journalEvidence: historical,
    checkpoints: checkpoint,
    extractor,
    verifyImport,
    usageBudget: reserveAttempt,
    clock,
    userTimezone,
    workContext
  }) {
    if (!store?.read || !store?.commit || !historical?.read || !checkpoint?.writeChunk || !extractor?.extract || typeof verifyImport !== 'function' || typeof reserveAttempt !== 'function' || typeof clock !== 'function' || typeof userTimezone !== 'function') throw new TypeError('Invalid knowledge import dependencies');
    this.#store = store;
    this.#historical = historical;
    this.#checkpoint = checkpoint;
    this.#extractor = extractor;
    this.#authority = {
      verify: verifyImport
    };
    this.#reserve = reserveAttempt;
    this.#clock = clock;
    this.#timezone = userTimezone;
    this.#workContext = workContext;
  }
  #active() {
    if (this.#closed) fail('KNOWLEDGE_IMPORT_STOPPED');
  }
  async #workCoverage(manifest) {
    let coverage = {
      complete: false,
      reason: 'work_context_unavailable',
      sources: []
    };
    try {
      if (this.#workContext?.execute) coverage = (await this.#workContext.execute({
        username: manifest.username,
        asOf: manifest.asOf
      })).coverage;
    } catch {/* Corroboration failure never becomes user evidence. */}
    this.#active();
    return coverage?.sources?.length === 0 ? {
      ...coverage,
      complete: false,
      reason: coverage.reason ?? 'no_work_sources'
    } : coverage;
  }
  async #sources({
    username,
    from,
    asOf
  }) {
    this.#active();
    const messages = [],
      rejected = [],
      sourceHashes = {},
      cursors = new Set();
    let cursor;
    for (let page = 0; page < 10000; page++) {
      const result = await this.#historical.read({
        username,
        from,
        asOf,
        cursor
      });
      this.#active();
      for (const message of result.messages) {
        if (message.at < from || message.at > asOf || message.content.length > 20000) fail('KNOWLEDGE_IMPORT_INVALID_SOURCE');
        messages.push(message);
      }
      rejected.push(...result.rejected);
      for (const [ref, hash] of Object.entries(result.sourceHashes)) {
        if (sourceHashes[ref] && sourceHashes[ref] !== hash) fail('KNOWLEDGE_IMPORT_SOURCE_CHANGED');
        sourceHashes[ref] = hash;
      }
      if (result.complete) return {
        messages: messages.sort((a, b) => a.at - b.at || a.ref.localeCompare(b.ref)),
        sourceHashes,
        rejected
      };
      const fingerprint = importDigest(result.nextCursor);
      if (!result.nextCursor || cursors.has(fingerprint)) fail('KNOWLEDGE_IMPORT_INCOMPLETE');
      cursors.add(fingerprint);
      cursor = result.nextCursor;
    }
    fail('KNOWLEDGE_IMPORT_INCOMPLETE');
  }
  async #current(manifest) {
    if (!validImportManifest(manifest) || manifest.asOf > this.#clock() || manifest.timezone !== this.#timezone(manifest.username)) fail('KNOWLEDGE_IMPORT_INVALID_MANIFEST');
    const current = await this.#sources(manifest);
    if (importDigest(current.sourceHashes) !== importDigest(manifest.sourceHashes)) fail('KNOWLEDGE_IMPORT_SOURCE_CHANGED');
    return current;
  }
  #chunkMessages(chunk, sources) {
    if (!chunk || !Array.isArray(chunk.refs) || !chunk.refs.length || chunk.refs.length > 10 || new Set(chunk.refs).size !== chunk.refs.length) fail('KNOWLEDGE_IMPORT_INVALID_MANIFEST');
    const selected = chunk.refs.map(ref => sources.find(m => m.ref === ref));
    if (selected.some(m => !m) || selected.reduce((n, m) => n + m.content.length, 0) > 20000 || sourceDigest(selected) !== chunk.sourceDigest) fail('KNOWLEDGE_IMPORT_SOURCE_CHANGED');
    return selected;
  }
  async prepare({
    username,
    from,
    asOf,
    jobId
  }) {
    const timezone = this.#timezone(username);
    localDateFor(asOf, timezone);
    const manifest = {
      schema: 'knowledge-import/v1',
      username,
      from,
      asOf,
      jobId,
      timezone,
      sourceHashes: {}
    };
    if (!validImportManifest(manifest) || asOf > this.#clock()) fail('KNOWLEDGE_IMPORT_INVALID_MANIFEST');
    const sources = await this.#sources(manifest),
      snapshot = await this.#store.read({
        username
      });
    this.#active();
    if (!snapshot.health.available) fail('KNOWLEDGE_UNAVAILABLE');
    const liveRefs = new Set(Object.values(snapshot.objects).flatMap(o => o.evidence.map(e => e.ref)));
    const consumed = new Set(snapshot.state.cursor?.seen ?? []);
    const selected = sources.messages.filter(m => snapshot.state.importedSourceHashes?.[m.originalRef] !== m.sourceHash && !liveRefs.has(m.originalRef) && !consumed.has(m.originalSourceId));
    const chunks = [];
    let pending = [],
      chars = 0;
    const flush = () => {
      if (!pending.length) return;
      chunks.push({
        chunkId: 'chunk-' + (chunks.length + 1),
        refs: pending.map(m => m.ref),
        sourceDigest: sourceDigest(pending)
      });
      pending = [];
      chars = 0;
    };
    for (const message of selected) {
      if (pending.length >= 10 || chars + message.content.length > 20000) flush();
      pending.push(message);
      chars += message.content.length;
    }
    flush();
    manifest.sourceHashes = sources.sourceHashes;
    manifest.chunks = chunks;
    manifest.excludedRefs = sources.messages.filter(m => !selected.includes(m)).map(m => m.ref);
    return {
      manifest,
      chunks,
      report: {
        complete: true,
        workCoverage: await this.#workCoverage(manifest),
        selected: selected.length,
        excluded: manifest.excludedRefs.length,
        rejected: sources.rejected
      }
    };
  }
  resume({
    manifest,
    usageDir
  }) {
    const frozen = structuredClone(manifest),
      key = importDigest(frozen);
    if (this.#running.has(key)) return this.#running.get(key);
    const work = this.#resume(frozen, usageDir).finally(() => {
      if (this.#running.get(key) === work) this.#running.delete(key);
    });
    this.#running.set(key, work);
    return work;
  }
  async #resume(manifest, usageDir) {
    const current = await this.#current(manifest);
    let snapshot = await this.#store.read({
      username: manifest.username
    });
    if (!snapshot.health.available) fail('KNOWLEDGE_UNAVAILABLE');
    const entries = [],
      rejected = [];
    let reason = null;
    const processChunk = async chunk => {
      this.#active();
      const messages = this.#chunkMessages(chunk, current.messages);
      const key = {
        jobId: manifest.jobId,
        chunkId: chunk.chunkId,
        sourceDigest: chunk.sourceDigest
      };
      let cached = await this.#checkpoint.readChunk(key);
      if (!cached) {
        try {
          await this.#reserve({
            usageDir,
            username: manifest.username,
            timezone: manifest.timezone,
            now: this.#clock()
          });
        } catch (error) {
          if (!/budget.*exhausted/i.test(error.message)) throw error;
          reason = 'budget_exhausted';
          return false;
        }
        this.#active();
        let result;
        try {
          result = await this.#extractor.extract({
            messages,
            openLoops: Object.values(snapshot.objects),
            roster: snapshot.roster,
            askedLoops: snapshot.asks,
            timezone: manifest.timezone,
            asOf: manifest.asOf
          });
        } catch {
          await this.#checkpoint.append({
            ...key,
            resultDigest: importDigest({
              error: 'extraction_failed'
            }),
            status: 'failed'
          });
          reason = 'extraction_failed';
          return false;
        }
        this.#active();
        if (!Array.isArray(result?.proposals) || result.proposals.length > 20) fail('KNOWLEDGE_IMPORT_INVALID_RESULT');
        cached = await this.#checkpoint.writeChunk({
          ...key,
          result
        });
      }
      const {
        result,
        resultDigest
      } = cached;
      if (!Array.isArray(result?.proposals) || result.proposals.length > 20 || resultDigest !== importDigest(result)) fail('KNOWLEDGE_IMPORT_INVALID_RESULT');
      if (result.proposals.length === 20) {
        await this.#checkpoint.append({
          ...key,
          resultDigest,
          status: 'saturated'
        });
        if (messages.length === 1) {
          reason = 'proposal_cap';
          return false;
        }
        const middle = Math.ceil(messages.length / 2);
        for (const [suffix, rows] of [['a', messages.slice(0, middle)], ['b', messages.slice(middle)]]) {
          if (!(await processChunk({
            chunkId: chunk.chunkId + '-' + suffix,
            refs: rows.map(m => m.ref),
            sourceDigest: sourceDigest(rows)
          }))) return false;
        }
        return true;
      }
      if (result.proposals.some(p => !chunk.refs.includes(p.evidenceRef))) fail('KNOWLEDGE_IMPORT_INVALID_RESULT');
      const times = new Map(messages.map(message => [message.ref, message.at]));
      const ordered = [...result.proposals].sort((a, b) => times.get(a.evidenceRef) - times.get(b.evidenceRef));
      const reduction = reduceKnowledge({
        snapshot,
        proposals: ordered,
        evidence: messages,
        asOf: manifest.asOf,
        timezone: manifest.timezone,
        mode: 'preview'
      });
      snapshot = project(snapshot, reduction.batch);
      rejected.push(...reduction.rejected);
      entries.push({
        ...chunk,
        resultDigest,
        result
      });
      await this.#checkpoint.append({
        ...key,
        resultDigest,
        status: 'complete'
      });
      return true;
    };
    if (!Array.isArray(manifest.chunks)) fail('KNOWLEDGE_IMPORT_INVALID_MANIFEST');
    for (const chunk of manifest.chunks) {
      if (!(await processChunk(chunk))) break;
    }
    await this.#current(manifest);
    const denied = new Set(rejected.map(row => row.proposalId));
    const targets = new Set(entries.flatMap(entry => entry.result.proposals.filter(p => !denied.has(p.id)).map(p => p.target)));
    const summarized = [...targets].map(id => snapshot.objects[id]).filter(Boolean).map(({
      id,
      title,
      status,
      created
    }) => ({
      id,
      title,
      status,
      sourceAt: created.sourceAt
    }));
    const report = {
      supportedOutcomes: summarized.filter(o => ['answered', 'dropped'].includes(o.status)),
      unresolvedCandidates: summarized.filter(o => ['open', 'waiting'].includes(o.status)),
      ambiguousMatches: snapshot.state.pendingReviews.filter(r => ['ambiguous_person_name', 'person_confirmation', 'alias_confirmation'].includes(r.reason)),
      unsupportedDates: snapshot.state.pendingReviews.filter(r => r.reason === 'unsupported_due_text'),
      skippedEvidence: current.rejected,
      workCoverage: await this.#workCoverage(manifest),
      complete: reason === null,
      reason,
      completedChunks: entries.length,
      rejected,
      sourceRejections: current.rejected
    };
    const artifact = {
      schema: 'knowledge-import-artifact/v1',
      manifestDigest: importDigest(manifest),
      entries,
      complete: report.complete
    };
    return {
      artifact,
      checkpoint: await this.#checkpoint.read({
        jobId: manifest.jobId
      }),
      report
    };
  }
  async commit({
    manifest: inputManifest,
    artifact: inputArtifact,
    capability
  }) {
    this.#active();
    const manifest = structuredClone(inputManifest),
      artifact = structuredClone(inputArtifact);
    if (!artifact?.complete) fail('KNOWLEDGE_IMPORT_INCOMPLETE');
    if (artifact.schema !== 'knowledge-import-artifact/v1' || artifact.manifestDigest !== importDigest(manifest)) fail('KNOWLEDGE_IMPORT_DENIED');
    const current = await this.#current(manifest),
      artifactDigest = importDigest(artifact);
    if (!this.#authority.verify({
      manifest,
      artifactDigest,
      sourceHashes: current.sourceHashes,
      capability
    })) fail('KNOWLEDGE_IMPORT_DENIED');
    await this.#store.recover?.({
      username: manifest.username
    });
    this.#active();
    const initial = await this.#store.read({
      username: manifest.username
    });
    this.#active();
    if (!initial.health.available) fail('KNOWLEDGE_UNAVAILABLE');
    const previous = initial.state.importedJobs?.[manifest.jobId];
    if (previous) {
      if (previous !== artifactDigest) fail('KNOWLEDGE_IMPORT_DENIED');
      return {
        applied: false,
        revision: initial.revision,
        report: {
          complete: true,
          replay: true
        }
      };
    }
    const expected = manifest.chunks.flatMap(c => c.refs).sort(),
      actual = artifact.entries.flatMap(e => e.refs).sort();
    if (importDigest(expected) !== importDigest(actual) || new Set(actual).size !== actual.length) fail('KNOWLEDGE_IMPORT_INCOMPLETE');
    const proposals = [];
    for (const entry of artifact.entries) {
      this.#chunkMessages(entry, current.messages);
      if (!Array.isArray(entry.result?.proposals) || entry.result.proposals.length >= 20 || entry.resultDigest !== importDigest(entry.result) || entry.result.proposals.some(p => !entry.refs.includes(p.evidenceRef))) fail('KNOWLEDGE_IMPORT_INVALID_RESULT');
      proposals.push(...entry.result.proposals);
    }
    const evidence = current.messages.filter(m => actual.includes(m.ref)),
      byRef = new Map(evidence.map(m => [m.ref, m]));
    proposals.sort((a, b) => byRef.get(a.evidenceRef).at - byRef.get(b.evidenceRef).at);
    const asOf = this.#clock();
    const {
      batch,
      rejected
    } = reduceKnowledge({
      snapshot: initial,
      proposals,
      evidence,
      asOf,
      timezone: manifest.timezone,
      mode: 'import',
      allowedImportRefs: actual,
      importJobId: manifest.jobId
    });
    const importedSourceHashes = {
        ...initial.state.importedSourceHashes
      },
      importAuthorizations = {
        ...initial.state.importAuthorizations
      };
    for (const m of evidence) {
      importedSourceHashes[m.originalRef] = m.sourceHash;
      importAuthorizations[m.ref] = {
        originalRef: m.originalRef,
        sourceHash: m.sourceHash,
        from: manifest.from,
        asOf: manifest.asOf,
        jobId: manifest.jobId
      };
    }
    Object.assign(batch.statePatch, {
      importedSourceHashes,
      importAuthorizations,
      importedJobs: {
        ...initial.state.importedJobs,
        [manifest.jobId]: artifactDigest
      }
    });
    batch.events.push({
      id: 'import:' + manifest.jobId,
      type: 'knowledge.import',
      at: asOf,
      jobId: manifest.jobId,
      sourceHashes: manifest.sourceHashes,
      artifactDigest
    });
    await this.#current(manifest);
    this.#active();
    if (!this.#authority.verify({
      manifest,
      artifactDigest,
      sourceHashes: current.sourceHashes,
      capability
    })) fail('KNOWLEDGE_IMPORT_DENIED');
    const result = await this.#store.commit({
      username: manifest.username,
      expectedRevision: initial.revision,
      runId: 'import:' + manifest.jobId,
      batch
    });
    return {
      ...result,
      report: {
        complete: true,
        imported: batch.upserts.length,
        rejected
      }
    };
  }
  close() {
    this.#closed = true;
  }
}
