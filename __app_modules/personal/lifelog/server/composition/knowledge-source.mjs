import { JournalKnowledgeFile } from '../adapters/knowledge/JournalKnowledgeFile.mjs';
/** Shared CLI/live source without an alternate data-tree or error-swallowing fallback. */
export function createJournalKnowledgeSource(options) {
  const source = new JournalKnowledgeFile(options);
  return username => source.read(username);
}
