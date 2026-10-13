/** Supplies already-projected lifelog observations without exposing source storage. */
export class ILifelogSourceRegistry {
  availableSources() { throw new Error('ILifelogSourceRegistry.availableSources not implemented'); }
  async readDay(_username, _date) { throw new Error('ILifelogSourceRegistry.readDay not implemented'); }
  async readRange(_username, _dates) { throw new Error('ILifelogSourceRegistry.readRange not implemented'); }
}

export default ILifelogSourceRegistry;
