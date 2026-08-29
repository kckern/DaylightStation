export class IContactSheetArtifacts {
  async prepare(_collection) { throw new Error('IContactSheetArtifacts.prepare must be implemented'); }
  target(_collection, _name) { throw new Error('IContactSheetArtifacts.target must be implemented'); }
}
