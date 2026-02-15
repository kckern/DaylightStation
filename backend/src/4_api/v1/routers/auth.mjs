// backend/src/4_api/v1/routers/auth.mjs
import express from 'express';
import { signToken } from '#system/auth/jwt.mjs';
import { asyncHandler } from '#system/http/middleware/index.mjs';

export function createAuthRouter({ authService, jwtSecret, jwtConfig, configService, dataService, logger = console }) {
  const router = express.Router();

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
    logger.info('auth.token.issued', { username });
    res.json({ token });
  }));

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

    const token = issueToken(user);
    logger.info('auth.claim.complete', { username });
    res.json({ token });
  }));

  // GET /auth/context — public household info for login screen
  router.get('/context', (req, res) => {
    const householdId = req.householdId || configService.getDefaultHouseholdId();
    const household = dataService.household.read('config/household');

    res.json({
      householdId,
      householdName: household?.name || 'DaylightStation',
      authMethod: 'password',
      isLocal: req.isLocal || false,
      needsSetup: authService.needsSetup()
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
      logger.info('auth.invite.accepted', { username: user.username });
      res.json({ token });
    } catch (err) {
      return res.status(404).json({ error: 'Invalid or expired invite' });
    }
  }));

  return router;
}

export default createAuthRouter;
