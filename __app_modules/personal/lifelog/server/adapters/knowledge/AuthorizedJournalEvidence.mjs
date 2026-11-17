import { IKnowledgeEvidence } from '../../application/knowledge/ports/IKnowledgeEvidence.mjs';
import { importDigest } from '../../domain/knowledge/importManifest.mjs';

/** Durably authorized imports are readable memory, never newly received chat messages. */
export class AuthorizedJournalEvidence extends IKnowledgeEvidence {
  #live;
  #historical;
  #authorizations;
  constructor({
    live,
    historical,
    readAuthorizations
  }) {
    super();
    this.#live = live;
    this.#historical = historical;
    this.#authorizations = readAuthorizations;
  }
  readUserMessages(input) {
    return this.#live.readUserMessages(input);
  }
  async #resolve(username, wanted) {
    const authorizations = await this.#authorizations({
      username
    });
    const groups = new Map(),
      resolved = [];
    for (const [ref, proof] of Object.entries(authorizations ?? {})) {
      if (wanted && !wanted.has(ref)) continue;
      if (!/^journalist:msg:[a-f0-9]{64}$/.test(ref) || !/^[a-f0-9]{64}$/.test(proof?.sourceHash ?? '') || typeof proof.originalRef !== 'string' || !proof.jobId || !Number.isFinite(proof.from) || !Number.isFinite(proof.asOf) || proof.asOf - proof.from > 90 * 86400000 || proof.asOf < proof.from) continue;
      const key = importDigest([proof.from, proof.asOf]);
      if (!groups.has(key)) groups.set(key, {
        from: proof.from,
        asOf: proof.asOf,
        refs: new Map()
      });
      groups.get(key).refs.set(ref, proof);
    }
    for (const group of groups.values()) {
      let cursor;
      const seen = new Set();
      for (let page = 0; page < 10000; page++) {
        const result = await this.#historical.read({
          username,
          from: group.from,
          asOf: group.asOf,
          cursor
        });
        for (const message of result.messages) {
          const proof = group.refs.get(message.ref);
          if (proof?.sourceHash === message.sourceHash && proof.originalRef === message.originalRef) resolved.push({
            ...message,
            verified: true,
            previewOnly: false,
            verificationKind: 'operator_import'
          });
        }
        if (result.complete) break;
        const key = importDigest(result.nextCursor);
        if (!result.nextCursor || seen.has(key) || page === 9999) throw new Error('Imported evidence unavailable');
        seen.add(key);
        cursor = result.nextCursor;
      }
    }
    return {
      authorizations,
      resolved
    };
  }
  async readByRefs({
    username,
    refs,
    preview = false
  }) {
    const live = await this.#live.readByRefs({
      username,
      refs,
      preview
    });
    const {
      resolved
    } = await this.#resolve(username, new Set(refs));
    return [...new Map([...live, ...resolved].map(row => [row.ref, row])).values()];
  }
  async readRevocations({
    username
  }) {
    const live = await this.#live.readRevocations({
      username
    });
    const {
      authorizations,
      resolved
    } = await this.#resolve(username);
    const valid = new Set(resolved.map(row => row.ref));
    return [...new Set([...live, ...Object.keys(authorizations ?? {}).filter(ref => !valid.has(ref))])];
  }
}
