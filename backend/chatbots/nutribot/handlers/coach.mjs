// Nutriboat /coach handler
// Responsibility: Provide coaching tip or recommendation (stub)
import { logger } from '../../_lib/logging.mjs';

const SAMPLE_TIPS = [
  'Stay hydrated: drink a glass of water before meals.',
  'Aim for at least 25g of fiber today.',
  'Balance your plate: half veggies, quarter protein, quarter carbs.',
  'Don\'t forget a protein-rich snack post-workout.'
];

export default async function coachHandler(req, res) {
  const log = logger.child({ bot: 'nutribot', route: 'coach', traceId: req.traceId });
  const tip = SAMPLE_TIPS[Math.floor(Math.random() * SAMPLE_TIPS.length)];
  log.info('coach.tip.served', { tip });
  res.json({ ok: true, tip, traceId: req.traceId });
}
