export class IFeedbackRepository {
  saveAudio(_request) { throw new Error('IFeedbackRepository.saveAudio must be implemented'); }
  save(_item) { throw new Error('IFeedbackRepository.save must be implemented'); }
  load(_app, _id) { throw new Error('IFeedbackRepository.load must be implemented'); }
  listApps() { throw new Error('IFeedbackRepository.listApps must be implemented'); }
  list(_app) { throw new Error('IFeedbackRepository.list must be implemented'); }
  remove(_item) { throw new Error('IFeedbackRepository.remove must be implemented'); }
  findAudioResource(_app, _id) { throw new Error('IFeedbackRepository.findAudioResource must be implemented'); }
}
