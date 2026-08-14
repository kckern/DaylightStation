/** Persistence port for game config, ladder progress, records, and archives. */
export class IPianoGameRepository {
  readConfig(_gameId, _userId) { throw new Error('readConfig not implemented'); }
  writeConfig(_gameId, _userId, _config) { throw new Error('writeConfig not implemented'); }
  readProgress(_gameId, _userId) { throw new Error('readProgress not implemented'); }
  writeProgress(_gameId, _userId, _progress) { throw new Error('writeProgress not implemented'); }
  saveRecord(_gameId, _userId, _record) { throw new Error('saveRecord not implemented'); }
  saveArchive(_gameId, _userSegment, _record) { throw new Error('saveArchive not implemented'); }
}
