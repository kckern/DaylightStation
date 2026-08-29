export class IAuthAccountRepository {
  listAccounts() { throw new Error('IAuthAccountRepository.listAccounts must be implemented'); }
  getAccount(_username) { throw new Error('IAuthAccountRepository.getAccount must be implemented'); }
  createOwner(_owner) { throw new Error('IAuthAccountRepository.createOwner must be implemented'); }
  recordLogin(_username, _at) { throw new Error('IAuthAccountRepository.recordLogin must be implemented'); }
  setCredentials(_username, _credentials) { throw new Error('IAuthAccountRepository.setCredentials must be implemented'); }
  createInvite(_username, _invite) { throw new Error('IAuthAccountRepository.createInvite must be implemented'); }
  findInvite(_token) { throw new Error('IAuthAccountRepository.findInvite must be implemented'); }
  acceptInvite(_username, _acceptance) { throw new Error('IAuthAccountRepository.acceptInvite must be implemented'); }
  ensureAuthenticationConfiguration(_configuration) { throw new Error('IAuthAccountRepository.ensureAuthenticationConfiguration must be implemented'); }
  getAuthenticationConfiguration() { throw new Error('IAuthAccountRepository.getAuthenticationConfiguration must be implemented'); }
}

export function isAuthAccountRepository(value) {
  return value != null
    && typeof value.listAccounts === 'function'
    && typeof value.getAccount === 'function'
    && typeof value.createOwner === 'function'
    && typeof value.recordLogin === 'function'
    && typeof value.setCredentials === 'function'
    && typeof value.createInvite === 'function'
    && typeof value.findInvite === 'function'
    && typeof value.acceptInvite === 'function'
    && typeof value.ensureAuthenticationConfiguration === 'function'
    && typeof value.getAuthenticationConfiguration === 'function';
}
