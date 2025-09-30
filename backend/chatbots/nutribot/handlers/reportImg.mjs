// Nutriboat /report/img handler
// Responsibility: generate or retrieve an image representing the nutrition report (stub)
import { logger } from '../../_lib/logging.mjs';

export default async function reportImgHandler(req, res) {
  const log = logger.child({ bot: 'nutribot', route: 'report/img', traceId: req.traceId });
  const { date = new Date().toISOString().slice(0,10) } = req.query;
  log.debug('report.image.start', { date });
  // Placeholder 1x1 png pixel (transparent)
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==';
  const img = Buffer.from(pngBase64, 'base64');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('X-Report-Date', date);
  res.send(img);
}
