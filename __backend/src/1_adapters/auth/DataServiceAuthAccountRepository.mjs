import { IAuthAccountRepository } from '#apps/auth/ports/IAuthAccountRepository.mjs';

/** Maps the legacy DataService YAML layout to semantic authentication accounts. */
export class DataServiceAuthAccountRepository extends IAuthAccountRepository {
  #dataService;
  #configService;

  constructor({ dataService, configService }) {
    super();
    if (!dataService || !configService) throw new Error('DataServiceAuthAccountRepository requires dataService and configService');
    this.#dataService = dataService;
    this.#configService = configService;
  }

  #profile(username) { return this.#dataService.user.read('profile', username); }
  #login(username) { return this.#dataService.user.read('auth/login', username); }
  #toAccount(username, profile = this.#profile(username), login = this.#login(username)) {
    if (!profile) return null;
    return {
      username: profile.username || username,
      householdId: profile.household_id || this.#configService.getDefaultHouseholdId(),
      roles: profile.roles || [],
      displayName: profile.display_name || '',
      passwordDigest: login?.password_hash || null,
      inviteToken: login?.invite_token || null,
    };
  }

  listAccounts() {
    return [...this.#configService.getAllUserProfiles().entries()]
      .map(([username, profile]) => this.#toAccount(username, profile, this.#login(username)));
  }

  getAccount(username) { return this.#toAccount(username); }

  createOwner({ username, householdId, householdName, passwordDigest, authenticatedAt, authenticationConfiguration }) {
    this.#dataService.user.write('profile', {
      username, household_id: householdId, roles: ['sysadmin'], type: 'owner', group: 'primary',
    }, username);
    this.#dataService.user.write('auth/login', {
      password_hash: passwordDigest, invite_token: null, invited_by: null, invited_at: null, last_login: authenticatedAt,
    }, username);
    this.#dataService.household.write('household', {
      household_id: householdId, name: householdName, head: username, users: [username],
    });
    this.#dataService.system.write('config/auth', authenticationConfiguration);
  }

  recordLogin(username, at) {
    const login = this.#login(username) || {};
    this.#dataService.user.write('auth/login', { ...login, last_login: at }, username);
  }

  setCredentials(username, { passwordDigest, authenticatedAt }) {
    this.#dataService.user.write('auth/login', {
      password_hash: passwordDigest, invite_token: null, invited_by: null, invited_at: null, last_login: authenticatedAt,
    }, username);
  }

  createInvite(username, { token, invitedBy, invitedAt }) {
    const existing = this.#login(username) || {};
    this.#dataService.user.write('auth/login', {
      ...existing, invite_token: token, invited_by: invitedBy, invited_at: invitedAt, password_hash: null,
    }, username);
  }

  findInvite(token) {
    for (const [username, profile] of this.#configService.getAllUserProfiles()) {
      const login = this.#login(username);
      if (login?.invite_token === token) return this.#toAccount(username, profile, login);
    }
    return null;
  }

  acceptInvite(username, { passwordDigest, displayName, authenticatedAt }) {
    const profile = this.#profile(username);
    const login = this.#login(username) || {};
    this.#dataService.user.write('auth/login', {
      ...login, password_hash: passwordDigest, invite_token: null, last_login: authenticatedAt,
    }, username);
    if (displayName && displayName !== profile?.display_name) {
      this.#dataService.user.write('profile', { ...profile, display_name: displayName }, username);
    }
  }

  ensureAuthenticationConfiguration(configuration) {
    if (!this.#dataService.system.read('config/auth')) this.#dataService.system.write('config/auth', configuration);
  }

  getAuthenticationConfiguration() { return this.#dataService.system.read('config/auth'); }
}

export default DataServiceAuthAccountRepository;
