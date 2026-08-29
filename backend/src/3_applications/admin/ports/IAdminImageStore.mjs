export class IAdminImageStore {
  list() { throw new Error('IAdminImageStore.list must be implemented'); }
  save(_record) { throw new Error('IAdminImageStore.save must be implemented'); }
}
