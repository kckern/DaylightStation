/**
 * Admin Household Router (thin HTTP shell)
 *
 * CRUD API for managing household config, member profiles, and devices.
 * All persistence + business rules live in HouseholdAdminService
 * (#apps/admin/HouseholdAdminService.mjs). This router only extracts params,
 * calls the service, and shapes the HTTP response. Typed errors thrown by the
 * service propagate to the P1.3 string error-middleware (ValidationError→400,
 * NotFoundError→404, ConflictError→409).
 *
 * Endpoints (all under /api/v1/admin/household):
 * - GET    /                   - Read household config + all member profiles
 * - PUT    /                   - Update household top-level fields (name, head, apps)
 * - POST   /members            - Create new member (profile + add to users list)
 * - GET    /members/:username  - Read a specific user's profile
 * - PUT    /members/:username  - Update a user's profile
 * - DELETE /members/:username  - Remove from household users list (keep profile)
 * - GET    /devices            - List all devices
 * - POST   /devices            - Add a new device
 * - GET    /devices/:deviceId  - Read a single device
 * - PUT    /devices/:deviceId  - Update a device
 * - DELETE /devices/:deviceId  - Remove a device
 */
import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';

/**
 * Create Admin Household Router
 *
 * @param {Object} config
 * @param {Object} config.householdAdminService - Injected HouseholdAdminService (from the
 *   composition root). Owns all persistence + business rules.
 * @param {Object} [config.logger=console] - Logger instance
 * @returns {express.Router}
 */
export function createAdminHouseholdRouter(config) {
  const { householdAdminService: service, logger = console } = config;
  if (!service) {
    throw new Error('createAdminHouseholdRouter requires an injected householdAdminService');
  }
  const router = express.Router();

  // GET / - Read household config + all member profiles
  router.get('/', asyncHandler((req, res) => {
    res.json(service.getHousehold());
  }));

  // PUT / - Update household top-level fields (name, head, apps)
  router.put('/', asyncHandler((req, res) => {
    const { household } = service.updateHousehold(req.body || {});
    res.json({ ok: true, household });
  }));

  // POST /members - Create new member
  router.post('/members', asyncHandler((req, res) => {
    const member = service.createMember(req.body || {});
    res.status(201).json({ ok: true, member });
  }));

  // GET /members/:username - Read a specific user's profile
  router.get('/members/:username', asyncHandler((req, res) => {
    const { member, authStatus } = service.getMember(req.params.username);
    res.json({ member, authStatus });
  }));

  // PUT /members/:username - Update a user's profile
  router.put('/members/:username', asyncHandler((req, res) => {
    const member = service.updateMember(req.params.username, req.body || {});
    res.json({ ok: true, member });
  }));

  // DELETE /members/:username - Remove from household users list (keep profile)
  router.delete('/members/:username', asyncHandler((req, res) => {
    const { username } = service.deleteMember(req.params.username);
    res.json({ ok: true, username });
  }));

  // GET /devices - List all devices
  router.get('/devices', asyncHandler((req, res) => {
    res.json({ devices: service.listDevices() });
  }));

  // POST /devices - Add a new device
  router.post('/devices', asyncHandler((req, res) => {
    const device = service.createDevice(req.body || {});
    res.status(201).json({ ok: true, device });
  }));

  // GET /devices/:deviceId - Read a single device
  router.get('/devices/:deviceId', asyncHandler((req, res) => {
    const device = service.getDevice(req.params.deviceId);
    res.json({ device });
  }));

  // PUT /devices/:deviceId - Update a device
  router.put('/devices/:deviceId', asyncHandler((req, res) => {
    const device = service.updateDevice(req.params.deviceId, req.body || {});
    res.json({ ok: true, device });
  }));

  // DELETE /devices/:deviceId - Remove a device
  router.delete('/devices/:deviceId', asyncHandler((req, res) => {
    const { id } = service.deleteDevice(req.params.deviceId);
    res.json({ ok: true, id });
  }));

  router.use(errorHandlerMiddleware({ shape: 'string' }));

  return router;
}

export default createAdminHouseholdRouter;
