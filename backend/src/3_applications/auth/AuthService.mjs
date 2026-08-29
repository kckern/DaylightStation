// backend/src/3_applications/auth/AuthService.mjs
import { isAuthAccountRepository } from './ports/IAuthAccountRepository.mjs';
import { isAuthenticationPrimitives } from './ports/IAuthenticationPrimitives.mjs';
import { createDefaultAuthenticationConfiguration } from './defaultAuthenticationConfiguration.mjs';

export class AuthService {
  #accounts;
  #authentication;
  #logger;

  constructor({ accounts, authentication, logger = console }) {
    if (!isAuthAccountRepository(accounts)) throw new Error('AuthService requires accounts');
    if (!isAuthenticationPrimitives(authentication)) throw new Error('AuthService requires authentication primitives');
    this.#accounts = accounts;
    this.#authentication = authentication;
    this.#logger = logger;
  }

  needsSetup() {
    const accounts = this.#accounts.listAccounts();
    return accounts.length === 0 || !accounts.some(account => account.passwordDigest);
  }

  async setup({ username, password, householdName }) {
    const householdId = 'default';

    const passwordDigest = await this.#authentication.hashSecret(password);
    this.#accounts.createOwner({
      username, householdId, householdName, passwordDigest,
      authenticatedAt: new Date().toISOString(),
      authenticationConfiguration: this.#createAuthenticationConfiguration(),
    });

    this.#logger.info('auth.setup.complete', { username, householdId });

    return { username, roles: ['sysadmin'], householdId };
  }

  async login(username, password) {
    const account = this.#accounts.getAccount(username);
    if (!account?.passwordDigest) return null;
    const valid = await this.#authentication.verifySecret(password, account.passwordDigest);
    if (!valid) return null;

    // Update last login
    this.#accounts.recordLogin(username, new Date().toISOString());

    this.#logger.info('auth.login.success', { username });

    return {
      username: account.username, householdId: account.householdId, roles: account.roles,
    };
  }

  async claim(username, password) {
    if (!this.needsSetup()) {
      throw new Error('Setup already complete');
    }

    const account = this.#accounts.getAccount(username);
    if (!account) return null;

    // Ensure auth config exists (generates JWT secret if missing)
    this.#accounts.ensureAuthenticationConfiguration(this.#createAuthenticationConfiguration());
    const passwordDigest = await this.#authentication.hashSecret(password);
    this.#accounts.setCredentials(username, { passwordDigest, authenticatedAt: new Date().toISOString() });

    this.#logger.info('auth.claim.complete', { username });

    return {
      username: account.username, householdId: account.householdId, roles: account.roles,
    };
  }

  async generateInvite(username, invitedBy) {
    if (!this.#accounts.getAccount(username)) throw new Error(`User not found: ${username}`);
    const token = this.#authentication.createInviteToken();
    this.#accounts.createInvite(username, { token, invitedBy, invitedAt: new Date().toISOString() });

    this.#logger.info('auth.invite.generated', { username, invitedBy });

    return { token };
  }

  resolveInviteToken(token) {
    const account = this.#accounts.findInvite(token);
    return account ? { username: account.username, displayName: account.displayName } : null;
  }

  async acceptInvite(token, { password, displayName }) {
    const resolved = this.resolveInviteToken(token);
    if (!resolved) throw new Error('Invalid invite token');

    const { username } = resolved;
    const account = this.#accounts.getAccount(username);
    const passwordDigest = await this.#authentication.hashSecret(password);
    this.#accounts.acceptInvite(username, { passwordDigest, displayName, authenticatedAt: new Date().toISOString() });

    this.#logger.info('auth.invite.accepted', { username });

    return {
      username,
      householdId: account.householdId, roles: account.roles,
    };
  }

  getAuthConfig() {
    return this.#accounts.getAuthenticationConfiguration();
  }

  #createAuthenticationConfiguration() {
    return createDefaultAuthenticationConfiguration(this.#authentication.createJwtSecret());
  }
}
