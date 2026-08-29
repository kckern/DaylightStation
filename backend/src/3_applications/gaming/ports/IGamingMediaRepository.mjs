/** Storage boundary for public gaming catalogs and their media resources. */
export class IGamingMediaRepository {
  getCatalog(_packId) { throw new Error('Not implemented'); }
  getAssetImage(_packId, _assetId) { throw new Error('Not implemented'); }
  getPartyMedia(_mediaId) { throw new Error('Not implemented'); }
}

export default IGamingMediaRepository;
