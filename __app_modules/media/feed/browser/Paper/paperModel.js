// The office paper newsstand: routes and the plain-words formatting of what
// the newsreporter API returns. The route table is
// ops:docs/superpowers/specs/2026-11-23-office-paper-design.md §6; nothing
// here talks to the network.

export const REPORTERS_PATH = '/api/v1/newsreporter';
export const BACK_ISSUE_LIMIT = 30;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isEditionDate = value => typeof value === 'string' && DATE_RE.test(value);

export function paperRoutes(reporterId) {
  const base = `${REPORTERS_PATH}/${encodeURIComponent(reporterId)}`;
  return {
    editions: `${base}/editions?limit=${BACK_ISSUE_LIMIT}`,
    edition: date => `${base}/editions/${date}`,
    image: (date, version) => `${base}/editions/${date}/image.png${version ? `?v=${encodeURIComponent(version)}` : ''}`,
    compose: `${base}/compose`,
    deliver: `${base}/deliver`,
    printers: `${base}/printers`,
  };
}

const listOf = (value, key) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.[key])) return value[key];
  return [];
};

/** Enabled reporters of the `edition` kind, in the order the API lists them. */
export const editionReporters = data => listOf(data, 'reporters')
  .filter(reporter => reporter && reporter.enabled !== false && reporter.kind === 'edition' && reporter.id);

export const editionSummaries = data => listOf(data, 'editions').filter(row => isEditionDate(row?.date));

export const printerNames = data => listOf(data, 'printers')
  .map(printer => (typeof printer === 'string' ? printer : printer?.name))
  .filter(Boolean);

export function dateLabel(date) {
  if (!isEditionDate(date)) return '';
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

export function shortDateLabel(date) {
  if (!isEditionDate(date)) return '';
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

export function clockTime(iso) {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

export const formatCost = costUsd => (typeof costUsd === 'number' && Number.isFinite(costUsd)
  ? `$${costUsd.toFixed(2)}`
  : 'cost unknown');

/** The last delivery an edition records: the summary's own fields, else the detail's `deliveries`. */
export function lastDelivery(summary, detail) {
  if (summary?.deliveredAt) return { at: summary.deliveredAt, printer: summary.printer || null };
  const deliveries = Array.isArray(detail?.deliveries) ? detail.deliveries : [];
  const last = deliveries[deliveries.length - 1];
  return last?.at ? { at: last.at, printer: last.printer || null } : null;
}

const FAILED = new Set(['failed', 'error']);

export function statusWord(summary) {
  if (!summary) return 'No edition';
  if (summary.deliveredAt) return 'Printed';
  if (FAILED.has(summary.status)) return 'Failed';
  if (summary.status === 'composed') return 'Not printed';
  return summary.status ? summary.status.replace(/_/g, ' ') : 'Unknown';
}

/** "Printed 08:11 · office" / "Composed 05:31 · not printed" / "No edition yet". */
export function statusLine({ summary, detail, isBackIssue }) {
  const edition = detail || summary;
  if (!edition) return isBackIssue ? 'No edition for this date' : 'No edition yet';
  const status = summary?.status || detail?.status;
  if (FAILED.has(status)) {
    const reason = detail?.error?.message || detail?.error || '';
    return `Compose failed${typeof reason === 'string' && reason ? `: ${reason}` : ''}`;
  }
  const delivery = lastDelivery(summary, detail);
  if (delivery) return [`Printed ${clockTime(delivery.at)}`.trim(), delivery.printer].filter(Boolean).join(' · ');
  const composedAt = summary?.composedAt || detail?.composedAt;
  return `${`Composed ${clockTime(composedAt)}`.trim()} · not printed`;
}

const countOf = value => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.length;
  return null;
};

/** "214 headlines · 14 stories · missing: strava". */
export function inputsLine({ summary, detail }) {
  const inputs = detail?.inputs || {};
  const headlines = countOf(inputs.headlines) ?? countOf(inputs.headlineCount) ?? countOf(inputs.candidates);
  const stories = Array.isArray(detail?.stories) ? detail.stories.length : null;
  const missing = listOf(inputs.missing ?? summary?.missing, 'missing').filter(Boolean);
  return [
    headlines != null ? `${headlines} headline${headlines === 1 ? '' : 's'}` : null,
    stories != null ? `${stories} stor${stories === 1 ? 'y' : 'ies'}` : null,
    missing.length ? `missing: ${missing.join(', ')}` : null,
  ].filter(Boolean).join(' · ');
}

const hostOf = url => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};

/**
 * The edition's stories as link groups. A stored story is
 * `{ ids, urls, titles }` (one story can cite several articles); each
 * title/url pair becomes one link.
 */
export function storyLinks(detail) {
  const stories = Array.isArray(detail?.stories) ? detail.stories : [];
  return stories.map((story, index) => {
    const urls = Array.isArray(story?.urls) ? story.urls : story?.url ? [story.url] : [];
    const titles = Array.isArray(story?.titles) ? story.titles : story?.title ? [story.title] : [];
    const links = urls.filter(Boolean).map((url, i) => ({
      url,
      title: titles[i] || titles[0] || hostOf(url) || url,
      host: hostOf(url),
    }));
    return { key: story?.ids?.[0] || `story-${index}`, links };
  }).filter(story => story.links.length);
}

/** The dry run's base64 PNG as an image source. */
export function previewSource(result) {
  const raw = result?.png ?? result?.image ?? result?.imageBase64 ?? result?.pngBase64;
  if (typeof raw !== 'string' || !raw) return null;
  return raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`;
}

/** The deliver outcomes (§6), in plain words for a notification. */
export function deliverOutcome(status, printer) {
  const where = printer ? ` on ${printer}` : '';
  switch (status) {
    case 'printed':
      return { color: 'green', title: 'Printed', message: `The paper printed${where}.` };
    case 'composed_then_printed':
      return { color: 'green', title: 'Composed and printed', message: `There was no edition yet, so one was written and printed${where}.` };
    case 'already_delivered':
      return { color: 'yellow', title: 'Already printed', message: 'This edition already printed today, so nothing printed.' };
    case 'expired':
      return { color: 'yellow', title: 'Too late to print', message: 'This edition is past its print window, so nothing printed.' };
    case 'print_failed':
      return { color: 'red', title: 'Print failed', message: `The printer did not take the job${where}. The edition stays unprinted; try again.` };
    default:
      return { color: 'yellow', title: 'Print result unclear', message: `The server answered "${status || 'nothing'}".` };
  }
}
