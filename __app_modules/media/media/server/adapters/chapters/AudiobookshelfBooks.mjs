/**
 * The Audiobookshelf side of track chapters: candidate books by title across the
 * book libraries, and one book's chapters. Wraps the existing AudiobookshelfClient.
 */
export class AudiobookshelfBooks {
  #client;
  #libraries = null;
  #librariesAt = 0;
  #now;

  /** @param {{ client: { getLibraries(), searchLibrary(id, q, limit), getItem(id) }, now?: () => number }} deps */
  constructor({ client, now = () => Date.now() }) {
    if (!client) throw new Error('AudiobookshelfBooks requires client');
    this.#client = client;
    this.#now = now;
  }

  async #bookLibraries() {
    // The library list rarely changes: asked once an hour.
    if (this.#libraries && this.#now() - this.#librariesAt < 3_600_000) return this.#libraries;
    const data = await this.#client.getLibraries();
    this.#libraries = (data?.libraries ?? []).filter((l) => l?.mediaType === 'book').map((l) => l.id);
    this.#librariesAt = this.#now();
    return this.#libraries;
  }

  /** @returns {Promise<Array<{id: string, path: string, durationMs: number, audioFiles: number}>>} */
  async find(title) {
    const out = [];
    for (const lib of await this.#bookLibraries()) {
      const res = await this.#client.searchLibrary(lib, title.slice(0, 120), 10);
      for (const hit of res?.book ?? []) {
        const item = hit?.libraryItem;
        const media = item?.media;
        if (!item?.id || !media) continue;
        const audioFiles = Number(media.numAudioFiles ?? media.audioFiles?.length ?? media.numTracks ?? 0);
        out.push({ id: item.id, path: item.path ?? '', durationMs: Math.round(Number(media.duration ?? 0) * 1000), audioFiles });
      }
    }
    return out;
  }

  /** One book's chapters as Audiobookshelf holds them (seconds). */
  async chapters(id) {
    const item = await this.#client.getItem(id);
    return item?.media?.chapters ?? [];
  }
}

export default AudiobookshelfBooks;
