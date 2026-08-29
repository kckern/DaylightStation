/** Resolves media-policy evidence through the configured content registry. */
export class RegistryMediaPolicyCatalog {
  constructor({ contentRegistry, primaryVoiceSource = null } = {}) {
    this.contentRegistry = contentRegistry;
    this.primaryVoiceSource = primaryVoiceSource;
    this.playlistItemIds = primaryVoiceSource
      ? async (playlistId) => {
          const source = this.contentRegistry?.get?.(this.primaryVoiceSource);
          return typeof source?.getPlaylistItemIds === 'function'
            ? source.getPlaylistItemIds(playlistId)
            : new Set();
        }
      : null;
  }

  ancestorLabels = async (item) => {
    const source = this.contentRegistry?.get?.(item?.source);
    return typeof source?.getAncestorLabels === 'function'
      ? source.getAncestorLabels(item)
      : [];
  };

}
