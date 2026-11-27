/**
 * POST /api/v1/media/household/playlists — a player's queue saved as a household list
 * (the phone's Queue → Save as playlist; ops:docs/superpowers/specs/2026-11-26-phone-queue.md §4).
 *
 * Body: { title: string, items: [{ id: "<source>:<id>", title?: string }] } in queue order.
 * Creates a `menus` list (content/lists/menus/<name>.yml) through the same list management
 * service as Admin, with the items in that order and a fixed order. A name already taken
 * gets a number ("queue-2026-11-26-2"). Answers 201 { ok, id: "menu:<name>", title, count }.
 */
import express from 'express';

const MAX_ITEMS = 1000;
const MAX_TITLE = 80;
const CONTENT_ID = /^[a-z][a-z0-9_-]{0,31}:[^\s|\\]{1,400}$/;

export function createHouseholdPlaylistsRouter({ listManagementService, logger = console }) {
  if (!listManagementService) throw new Error('createHouseholdPlaylistsRouter requires listManagementService');
  const router = express.Router();

  router.post('/household/playlists', (req, res) => {
    const householdId = req.query.household || undefined;
    const { title, items } = req.body || {};
    if (typeof title !== 'string' || !title.trim() || title.trim().length > MAX_TITLE) {
      return res.status(400).json({ error: `title is required (at most ${MAX_TITLE} characters)` });
    }
    if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
      return res.status(400).json({ error: `items must hold 1 to ${MAX_ITEMS} entries` });
    }
    const entries = [];
    for (const item of items) {
      const id = typeof item?.id === 'string' ? item.id.trim() : '';
      if (!CONTENT_ID.test(id)) return res.status(400).json({ error: 'every item needs a content id' });
      const label = typeof item.title === 'string' && item.title.trim() ? item.title.trim().slice(0, 200) : id;
      entries.push({ label, input: id });
    }

    const name = title.trim();
    let created = null;
    for (let n = 1; n <= 50 && !created; n++) {
      const candidate = n === 1 ? name : `${name} ${n}`;
      try {
        created = listManagementService.createList('menus', candidate, householdId);
      } catch (error) {
        if (error?.name === 'ConflictError' || /exists/i.test(error?.message || '')) continue;
        throw error;
      }
    }
    if (!created) return res.status(409).json({ error: 'a list with that name already exists' });

    listManagementService.replaceContents('menus', created.list, householdId, entries);
    listManagementService.updateSettings('menus', created.list, householdId, { title: name, fixed_order: true });
    logger.info?.('media.household.playlist.created', { list: created.list, count: entries.length, household: householdId });
    return res.status(201).json({ ok: true, id: `menu:${created.list}`, title: name, count: entries.length });
  });

  return router;
}

export default createHouseholdPlaylistsRouter;
