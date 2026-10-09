/** Semantic boundary used by the deprecated local-content endpoint operations. */
export class ILegacyLocalContentRepository {
  isConfigured() { throw new Error('Not implemented'); }
  resolveScripture(_input) { throw new Error('Not implemented'); }
  generateScriptureReference(_verseId, _fallback) { throw new Error('Not implemented'); }
  getItem(_key) { throw new Error('Not implemented'); }
  getList(_key) { throw new Error('Not implemented'); }
  listCollection(_name) { throw new Error('Not implemented'); }
  resolveAudioDuration(_kind, _number) { throw new Error('Not implemented'); }
  filterPlayableTalks(_children) { throw new Error('Not implemented'); }
  resolveTalkDuration(_item) { throw new Error('Not implemented'); }
  getTalkProgress() { throw new Error('Not implemented'); }
  getCoverArt(_mediaKey) { throw new Error('Not implemented'); }
  createPlaceholder(_mediaKey) { throw new Error('Not implemented'); }
  getCollectionCover(_adapter, _collection, _subPath) { throw new Error('Not implemented'); }
  getCollectionIcon(_adapter, _collection) { throw new Error('Not implemented'); }
}

export default ILegacyLocalContentRepository;
