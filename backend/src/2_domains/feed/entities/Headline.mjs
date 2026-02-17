/**
 * Headline Entity
 *
 * Lightweight representation of a news headline for the Headlines view.
 * Stores only id, source, title, desc, link, timestamp.
 *
 * @module domains/feed/entities
 */

import { shortIdFromUuid } from '../../core/utils/id.mjs';

export class Headline {
  #id; #source; #title; #desc; #link; #timestamp;

  /**
   * @param {Object} data
   * @param {string} data.id - Deterministic short ID (derived from link)
   * @param {string} data.source - Source ID (e.g., 'cnn', 'freshrss-12')
   * @param {string} data.title - Headline text
   * @param {string|null} [data.desc] - Short description (first sentence or 120 chars)
   * @param {string} data.link - URL to original article
   * @param {Date|string} [data.timestamp] - Publication time
   */
  constructor(data) {
    if (!data.id) throw new Error('Headline requires id');
    if (!data.source) throw new Error('Headline requires source');
    if (!data.title) throw new Error('Headline requires title');
    if (!data.link) throw new Error('Headline requires link');

    this.#id = data.id;
    this.#source = data.source;
    this.#title = data.title;
    this.#desc = data.desc || null;
    this.#link = data.link;
    this.#timestamp = data.timestamp ? new Date(data.timestamp) : new Date();

    Object.freeze(this);
  }

  get id() { return this.#id; }
  get source() { return this.#source; }
  get title() { return this.#title; }
  get desc() { return this.#desc; }
  get link() { return this.#link; }
  get timestamp() { return this.#timestamp; }

  /**
   * Factory for creating new Headlines (e.g., during harvesting).
   * Generates a deterministic id from the link URL.
   * @param {Object} data - Same as constructor but without id
   * @returns {Headline}
   */
  static create(data) {
    return new Headline({ ...data, id: shortIdFromUuid(data.link) });
  }

  truncateDesc(maxLength = 120) {
    if (!this.desc) return null;
    if (this.desc.length <= maxLength) return this.desc;
    return this.desc.substring(0, maxLength) + '...';
  }

  toJSON() {
    return {
      id: this.id,
      source: this.source,
      title: this.title,
      desc: this.desc,
      link: this.link,
      timestamp: this.timestamp.toISOString(),
    };
  }

  static fromJSON(data) {
    return new Headline({
      ...data,
      timestamp: new Date(data.timestamp),
    });
  }
}

export default Headline;
