// backend/src/4_api/v1/routers/auth.mjs
import express from 'express';
import { signToken } from '#system/auth/jwt.mjs';
import { asyncHandler } from '#system/http/middleware/index.mjs';

export function createAuthRouter({ authService, jwtSecret, jwtConfig, authPublicContext, logger = console }) {
  const router = express.Router();

  // 30 days, renewed on every issue. The JWT itself is configured `10y`, which
  // is effectively permanent — fine for a token that establishes identity
  // rather than guarding a perimeter, but a browser session should not outlive
  // the machine it was opened on. The cookie is the shorter of the two on
  // purpose; revoking before it lapses needs the server-side session record
  // that Admin's revoke list will add.
  const SESSION_COOKIE = 'daylight_session';
  const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

  // Path=/ because ONE sign-in must cover every adult app — /admin, /finance,
  // /health, /feed, the teacher console. Scoping it to /api/v1/auth (the way
  // the teacher cookie scopes to /api/v1/school) would make it useless for the
  // thing it exists to do. SameSite=Lax so an ordinary navigation carries it
  // while a cross-site POST does not.
  const sessionCookie = (req, token) => {
    const secure = req.secure || req.get('x-forwarded-proto') === 'https';
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_MAX_AGE}`
      + `; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  };

  /** Issue the token AND set it as the browser session. Every path that mints a
   *  token signs the person in; returning one without the cookie is what left
   *  each app to store and attach it itself. */
  const issueSession = (req, res, user, token) => {
    res.set('Set-Cookie', sessionCookie(req, token));
    logger.info('auth.session.issued', { username: user.username ?? user, maxAgeSec: SESSION_MAX_AGE });
  };

  function issueToken(user) {
    return signToken(
      { sub: user.username, hid: user.householdId, roles: user.roles },
      jwtSecret,
      { issuer: jwtConfig.issuer, expiresIn: jwtConfig.expiry, algorithm: jwtConfig.algorithm }
    );
  }

  // GET /auth/setup-status
  router.get('/setup-status', (req, res) => {
    res.json({ needsSetup: authService.needsSetup() });
  });

  // POST /auth/setup — first-boot wizard
  router.post('/setup', asyncHandler(async (req, res) => {
    if (!authService.needsSetup()) {
      return res.status(403).json({ error: 'System already configured' });
    }

    const { username, password, householdName } = req.body;
    if (!username || !password || !householdName) {
      return res.status(400).json({ error: 'Missing required fields: username, password, householdName' });
    }

    const user = await authService.setup({ username, password, householdName });

    // Re-read auth config to get the generated JWT secret for signing
    const authConfig = authService.getAuthConfig();
    const token = signToken(
      { sub: user.username, hid: user.householdId, roles: user.roles },
      authConfig.jwt.secret,
      { issuer: authConfig.jwt.issuer, expiresIn: authConfig.jwt.expiry, algorithm: authConfig.jwt.algorithm }
    );

    issueSession(req, res, user, token);
    logger.info('auth.setup.complete', { username });
    res.json({ token });
  }));

  // POST /auth/token — login
  router.post('/token', asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Missing required fields: username, password' });
    }

    const user = await authService.login(username, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = issueToken(user);
    issueSession(req, res, user, token);
    logger.info('auth.token.issued', { username });
    res.json({ token });
  }));

  // POST /auth/logout — drop the browser session.
  // The token stays valid (it is a 10y JWT and nothing revokes it yet); this
  // clears the transport, which is what "sign out on this device" means until
  // the session record lands. Says so rather than implying more.
  router.post('/logout', (req, res) => {
    res.set('Set-Cookie', `daylight_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    logger.info('auth.session.cleared', {});
    res.json({ ok: true });
  });

  // POST /auth/claim — first-boot: claim existing profile and set password
  router.post('/claim', asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Missing required fields: username, password' });
    }

    let user;
    try {
      user = await authService.claim(username, password);
    } catch (err) {
      return res.status(403).json({ error: err.message });
    }

    if (!user) {
      return res.status(404).json({ error: 'Username not found' });
    }

    // Re-read auth config for fresh JWT secret (may have just been created)
    const freshAuthConfig = authService.getAuthConfig();
    const token = signToken(
      { sub: user.username, hid: user.householdId, roles: user.roles },
      freshAuthConfig.jwt.secret,
      { issuer: freshAuthConfig.jwt.issuer, expiresIn: freshAuthConfig.jwt.expiry, algorithm: freshAuthConfig.jwt.algorithm }
    );
    issueSession(req, res, user, token);
    logger.info('auth.claim.complete', { username });
    res.json({ token });
  }));

  // GET /auth/context — public household info for login screen
  router.get('/context', (req, res) => {
    const needsSetup = authService.needsSetup();
    const context = authPublicContext.get({ householdId: req.householdId || null, needsSetup });

    res.json({
      householdId: context.householdId,
      householdName: context.householdName,
      authMethod: 'password',
      isLocal: req.isLocal || false,
      needsSetup,
      setupAdmin: context.setupAdmin
    });
  });

  // POST /auth/invite — generate invite link (requires admin access, enforced by permissionGate on /admin/*)
  router.post('/invite', asyncHandler(async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Missing required field: username' });
    }

    const { token } = await authService.generateInvite(username, req.user.sub);
    logger.info('auth.invite.created', { username, invitedBy: req.user.sub });
    res.json({ inviteUrl: `/invite/${token}` });
  }));

  // GET /auth/invite/:token — validate invite
  router.get('/invite/:token', (req, res) => {
    const result = authService.resolveInviteToken(req.params.token);
    if (!result) {
      return res.status(404).json({ error: 'Invalid or expired invite' });
    }
    res.json(result);
  });

  // POST /auth/invite/:token/accept — set password via invite
  router.post('/invite/:token/accept', asyncHandler(async (req, res) => {
    const { password, displayName } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Missing required field: password' });
    }

    try {
      const user = await authService.acceptInvite(req.params.token, { password, displayName });
      const token = issueToken(user);
      issueSession(req, res, user, token);
      logger.info('auth.invite.accepted', { username: user.username });
      res.json({ token });
    } catch (err) {
      return res.status(404).json({ error: 'Invalid or expired invite' });
    }
  }));

  return router;
}

export default createAuthRouter;
