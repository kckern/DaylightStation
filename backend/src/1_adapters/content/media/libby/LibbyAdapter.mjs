import { ListableItem } from '#domains/content/capabilities/Listable.mjs';
import { PlayableItem } from '#domains/content/capabilities/Playable.mjs';

function parseId(value) {
  const localId = String(value || '').replace(/^libby:/, '');
  const match = /^loan\/(\d+)\/(\d+)(?:\/part\/([a-z0-9._~-]+))?$/.exec(localId);
  return match ? { localId, cardId: match[1], titleId: match[2], partKey: match[3] || null } : null;
}

/** Content adapter for explicitly addressed active Libby audiobook loans. */
export class LibbyAdapter {
  #client;
  #leases;
  #proxyPath;
  #now;
  #loanReuseMs;
  #loanWindows = new Map();

  constructor({ client, leases, proxyPath = '/api/v1/proxy/libby/stream', now = Date.now, loanReuseMs = 60_000 } = {}) {
    if (!client?.openLoan) throw new Error('LibbyAdapter requires client');
    if (!leases?.issue) throw new Error('LibbyAdapter requires leases');
    if (typeof now !== 'function') throw new Error('LibbyAdapter requires clock');
    if (!Number.isFinite(loanReuseMs) || loanReuseMs < 0) throw new Error('LibbyAdapter requires non-negative loan reuse window');
    this.#client = client;
    this.#leases = leases;
    this.#proxyPath = proxyPath.replace(/\/$/, '');
    this.#now = now;
    this.#loanReuseMs = loanReuseMs;
  }

  get source() { return 'libby'; }
  get prefixes() { return [{ prefix: 'libby' }]; }

  async #loan(parsed) {
    const key = `${parsed.cardId}/${parsed.titleId}`;
    const now = this.#now();
    const cached = this.#loanWindows.get(key);
    if (cached && now < cached.reuseUntil && now < cached.loanExpiresAt) return cached.loan;

    this.#loanWindows.delete(key);
    const loan = await this.#client.openLoan({ cardId: parsed.cardId, titleId: parsed.titleId });
    const loanExpiresAt = Number.isFinite(loan?.expiresAt) ? loan.expiresAt : Infinity;
    const reuseUntil = Math.min(now + this.#loanReuseMs, loanExpiresAt);
    if (now < reuseUntil) this.#loanWindows.set(key, { loan, reuseUntil, loanExpiresAt });
    return loan;
  }

  #coverPath(parsed) {
    return `/api/v1/proxy/libby/cover/${encodeURIComponent(parsed.cardId)}/${encodeURIComponent(parsed.titleId)}`;
  }

  #partItem(parsed, loan, part) {
    const { handle } = this.#leases.issue({ loan, part });
    return new PlayableItem({
      id: `libby:loan/${parsed.cardId}/${parsed.titleId}/part/${part.key}`,
      source: 'libby', title: part.title || `${loan.title} — Part ${part.index + 1}`,
      mediaType: 'audio', mediaUrl: `${this.#proxyPath}/${handle}`,
      duration: part.duration, resumable: true, thumbnail: this.#coverPath(parsed),
      description: loan.description,
      metadata: {
        type: 'track', provider: 'libby', subtitle: loan.subtitle, author: loan.author, narrator: loan.narrator,
        parentTitle: loan.title, partIndex: part.index, loanExpiresAt: loan.expiresAt,
      },
      continuous: true,
    });
  }

  async getItem(id) {
    const parsed = parseId(id);
    if (!parsed) return null;
    const loan = await this.#loan(parsed);
    if (parsed.partKey) {
      const part = loan.parts.find((candidate) => candidate.key === parsed.partKey);
      return part ? this.#partItem(parsed, loan, part) : null;
    }
    return new ListableItem({
      id: `libby:loan/${parsed.cardId}/${parsed.titleId}`,
      source: 'libby', title: loan.title, itemType: 'container', childCount: loan.parts.length,
      mediaType: 'audio', thumbnail: this.#coverPath(parsed), description: loan.description,
      metadata: { type: 'audiobook', provider: 'libby', subtitle: loan.subtitle, author: loan.author, narrator: loan.narrator, loanExpiresAt: loan.expiresAt },
    });
  }

  async getList(id) { return this.resolvePlayables(id); }

  async resolvePlayables(id) {
    const parsed = parseId(id);
    if (!parsed || parsed.partKey) return [];
    const loan = await this.#loan(parsed);
    return loan.parts.map((part) => this.#partItem(parsed, loan, part));
  }

  async resolveSiblings() { return null; }
  getStoragePath() { return 'libby'; }

  getCapabilities(item) {
    if (item?.itemType === 'container') return ['listable', 'queueable'];
    return item?.mediaUrl ? ['playable'] : [];
  }
}

export default LibbyAdapter;
