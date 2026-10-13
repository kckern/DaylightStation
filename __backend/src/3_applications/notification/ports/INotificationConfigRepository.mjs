export class INotificationConfigRepository {
  load() { throw new Error('INotificationConfigRepository.load must be implemented'); }
  save(_config) { throw new Error('INotificationConfigRepository.save must be implemented'); }
}
