export class SessionJournal {
  async create(_sessionId, _record) { throw new Error('SessionJournal.create not implemented'); }
  async append(_sessionId, _record, _options) { throw new Error('SessionJournal.append not implemented'); }
  async read(_sessionId) { throw new Error('SessionJournal.read not implemented'); }
}
