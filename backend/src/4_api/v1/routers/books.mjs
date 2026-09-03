import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

const STATUS = { ok: 200, invalid: 400, 'not-found': 404, unavailable: 503 };

/** The lookup a child's shelf uses. No auth — book facts are not private. */
export function createBooksRouter({ resolveBook } = {}) {
  if (!resolveBook) throw new Error('createBooksRouter requires resolveBook');
  const router = express.Router();

  router.get('/resolve', asyncHandler(async (req, res) => {
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    if (!id.trim()) return res.status(400).json({ status: 'invalid', reason: 'empty' });
    const result = await resolveBook.execute(id, { refresh: req.query.refresh === '1' });
    return res.status(STATUS[result.status] ?? 400).json(result);
  }));

  return router;
}

export default createBooksRouter;
