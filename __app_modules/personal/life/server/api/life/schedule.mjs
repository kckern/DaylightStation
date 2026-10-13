import { Router } from 'express';

const FORMATTERS = {
  json: (ceremonies, res) => {
    res.json({ ceremonies });
  },

  ical: (ceremonies, res) => {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//DaylightStation//Life Schedule//EN',
      'CALSCALE:GREGORIAN',
    ];

    for (const c of ceremonies) {
      const uid = `${c.type}@daylightstation`;
      const summary = c.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${uid}`);
      lines.push(`SUMMARY:Life: ${summary}`);
      lines.push(`DESCRIPTION:${c.level} ceremony`);
      if (c.rrule) lines.push(`RRULE:${c.rrule}`);
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.send(lines.join('\r\n'));
  },

  rss: (ceremonies, res) => {
    const items = ceremonies.map(c => {
      const title = c.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      return `<item><title>${title}</title><description>${c.level} ceremony (${c.cadenceUnit})</description></item>`;
    }).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Life Ceremony Schedule</title>
    <description>Ceremony schedule from DaylightStation</description>
    ${items}
  </channel>
</rss>`;
    res.set('Content-Type', 'application/rss+xml; charset=utf-8');
    res.send(xml);
  },

  xml: (ceremonies, res) => {
    const items = ceremonies.map(c => {
      return `  <ceremony type="${c.type}" level="${c.level}" cadence="${c.cadenceUnit}" />`;
    }).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<schedule>\n${items}\n</schedule>`;
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
  },
};

export default function createScheduleRouter(config) {
  const { lifePlanOperations } = config;
  const router = Router();

  router.get('/:format', (req, res) => {
    const format = req.params.format;
    const formatter = FORMATTERS[format];
    if (!formatter) {
      return res.status(400).json({ error: `Unsupported format: ${format}. Supported: ${Object.keys(FORMATTERS).join(', ')}` });
    }

    const username = req.lifeUsername || req.query.username || 'default';
    const ceremonies = lifePlanOperations.readCeremonySchedule(username);
    if (!ceremonies) return res.status(404).json({ error: 'No plan found' });

    formatter(ceremonies, res);
  });

  return router;
}
