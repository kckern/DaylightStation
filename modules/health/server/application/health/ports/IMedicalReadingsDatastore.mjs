export class IMedicalReadingsDatastore {
  async load(userId) { throw new Error('IMedicalReadingsDatastore.load must be implemented'); }
  async save(doc, userId) { throw new Error('IMedicalReadingsDatastore.save must be implemented'); }
}
export default IMedicalReadingsDatastore;
