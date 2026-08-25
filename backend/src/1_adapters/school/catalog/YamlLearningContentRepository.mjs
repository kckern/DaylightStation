import path from 'node:path';
import { ILearningContentRepository } from '#apps/school/ports/ILearningContentRepository.mjs';
import { listYamlFiles, loadYaml } from '#system/utils/FileIO.mjs';

/** Resolve learning documents and ordinary School banks from configured data mounts. */
export class YamlLearningContentRepository extends ILearningContentRepository {
  #documentDirectories; #bankDirectories; #deckDirectories; #actionDirectories; #io;

  constructor({ documentDirectories, bankDirectories, deckDirectories = [], actionDirectories = [], io = {} } = {}) {
    super();
    if (!validDirectories(documentDirectories) || !validDirectories(bankDirectories)) {
      throw new Error('YamlLearningContentRepository requires documentDirectories and bankDirectories');
    }
    this.#documentDirectories = [...documentDirectories];
    this.#bankDirectories = [...bankDirectories];
    if (!Array.isArray(deckDirectories) || !deckDirectories.every((entry) => typeof entry === 'string' && entry.trim().length > 0)) {
      throw new Error('YamlLearningContentRepository deckDirectories must contain paths');
    }
    this.#deckDirectories = [...deckDirectories];
    if (!Array.isArray(actionDirectories) || !actionDirectories.every((entry) => (
      typeof entry === 'string' && entry.trim().length > 0
    ))) throw new Error('YamlLearningContentRepository actionDirectories must contain paths');
    this.#actionDirectories = [...actionDirectories];
    this.#io = { list: io.list ?? listYamlFiles, load: io.load ?? loadYaml };
  }

  async getDocument(documentId) {
    return this.#find(this.#documentDirectories, 'documentId', documentId, 'document');
  }

  async getQuestionBank(bankId) {
    return this.#find(this.#bankDirectories, 'id', bankId, 'question bank');
  }

  async getFlashcardDeck(deckId) {
    return this.#find(this.#deckDirectories, 'id', deckId, 'flashcard deck');
  }

  async listFlashcardDecks() {
    const decks = new Map();
    for (const directory of this.#deckDirectories) {
      const files = [...this.#io.list(directory, { recursive: true })].sort();
      for (const relative of files) {
        const filePath = path.join(directory, relative);
        const deck = this.#io.load(filePath);
        if (!deck?.id) continue;
        if (decks.has(deck.id)) throw new Error(`Duplicate School flashcard deck '${deck.id}' in '${decks.get(deck.id).__path}' and '${filePath}'`);
        decks.set(deck.id, { ...deck, __path: filePath });
      }
    }
    return [...decks.values()].map(({ __path, ...deck }) => structuredClone(deck));
  }

  async getLearningAction(actionId) {
    return this.#find(this.#actionDirectories, 'actionId', actionId, 'learning action');
  }

  #find(directories, idField, wantedId, kind) {
    let match = null;
    let matchPath = null;
    for (const directory of directories) {
      const files = [...this.#io.list(directory, { recursive: true })].sort();
      for (const relative of files) {
        const filePath = path.join(directory, relative);
        const document = this.#io.load(filePath);
        if (!document || document[idField] !== wantedId) continue;
        if (match) throw new Error(`Duplicate School ${kind} '${wantedId}' in '${matchPath}' and '${filePath}'`);
        match = document;
        matchPath = filePath;
      }
    }
    return match ? structuredClone(match) : null;
  }
}

function validDirectories(value) {
  return Array.isArray(value) && value.length > 0
    && value.every((entry) => typeof entry === 'string' && entry.trim().length > 0);
}

export default YamlLearningContentRepository;
