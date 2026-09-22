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

  constructor({ client, leases, proxyPath = '/api/v1/proxy/libby/stream' } = {}) {
    if (!client?.openLoan) throw new Error('LibbyAdapter requires client');
    if (!leases?.issue) throw new Error('LibbyAdapter requires leases');
    this.#client = client;
    this.#leases = leases;
    this.#proxyPath = proxyPath.replace(/\/$/, '');
  }

  get source() { return 'libby'; }
  get prefixes() { return [{ prefix: 'libby' }]; }

  async #loan(parsed) {
    return this.#client.openLoan({ cardId: parsed.cardId, titleId: parsed.titleId });
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
