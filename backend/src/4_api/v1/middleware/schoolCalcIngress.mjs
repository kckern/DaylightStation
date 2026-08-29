export function createSchoolCalcIngressAuthenticator({ credentialVerifier, logger = null } = {}) {
  if (!credentialVerifier?.verify) throw new Error('SchoolCalc ingress requires credentialVerifier');
  return (req, res, next) => {
    const assertedRelayId = req.get?.('X-SchoolCalc-Relay-Id') ?? null;
    const result = credentialVerifier.verify({
      authorization: req.get?.('Authorization'),
      assertedRelayId,
    });
    if (!result.ok) {
      logger?.warn?.('schoolcalc.ingress.rejected', { assertedRelayId: assertedRelayId || null, reason: result.reason });
      return res.status(401).json({ error: 'unauthorized' });
    }
    req.schoolCalcIngress = Object.freeze({ id: result.relayId });
    return next();
  };
}
