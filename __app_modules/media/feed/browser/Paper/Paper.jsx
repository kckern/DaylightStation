// /feed/paper — the newsstand for the office paper: today's edition as the
// image that printed, print / print to / recompose / preview, back issues at
// /feed/paper/:date. Spec: ops:docs/superpowers/specs/2026-11-23-office-paper-design.md §7.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import { Button } from '@/lib/ui/Button.jsx';
import { Select } from '@/lib/ui/Select.jsx';
import { EmptyState, ErrorState, LoadingState } from '@/lib/ui/states.jsx';
import { localDateKey } from '@/lib/calendarDay.js';
import { useApiResource } from '../../../../../frontend/src/lib/hooks/useApiResource.js';
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';
import {
  REPORTERS_PATH, dateLabel, deliverOutcome, editionReporters, editionSummaries, formatCost,
  inputsLine, isEditionDate, paperRoutes, previewSource, printerNames, shortDateLabel,
  statusLine, statusWord, storyLinks,
} from './paperModel.js';
import './Paper.scss';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'feed-paper' });
  return _logger;
}

const BUSY_WORDS = {
  print: 'Printing',
  printTo: 'Printing',
  compose: 'Recomposing',
  preview: 'Composing a preview',
  keep: 'Composing the edition',
};
// Composing reads the news and calls the model twice: 30 to 90 seconds.
const SLOW_ACTIONS = new Set(['compose', 'preview', 'keep']);

function useElapsedSeconds(running) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    if (!running) return undefined;
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return seconds;
}

export default function Paper() {
  const { date: routeDate } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const reportersResource = useApiResource(REPORTERS_PATH, { label: 'Newsreporter reporters', dedupe: false });
  const reporters = useMemo(() => editionReporters(reportersResource.data), [reportersResource.data]);
  const requested = searchParams.get('paper');
  const reporter = reporters.find(candidate => candidate.id === requested) || reporters[0] || null;
  const empty = reportersResource.hasResult && !reporters.length;

  useEffect(() => {
    if (empty) logger().info('paper.empty', { reporters: Array.isArray(reportersResource.data) ? reportersResource.data.length : null });
  }, [empty, reportersResource.data]);

  if (routeDate !== undefined && !isEditionDate(routeDate)) {
    return <Navigate to={`/feed/paper${searchParams.toString() ? `?${searchParams}` : ''}`} replace />;
  }
  if (reportersResource.error && !reportersResource.hasResult) {
    return <div className="feed-paper feed-paper--state">
      <ErrorState label="The paper" error={reportersResource.error} onRetry={reportersResource.reload} />
    </div>;
  }
  if (!reportersResource.hasResult) {
    return <div className="feed-paper feed-paper--state"><LoadingState label="the paper" /></div>;
  }
  if (!reporter) {
    return <div className="feed-paper feed-paper--state">
      <EmptyState title="No paper is configured"
        hint="Add an enabled reporter with kind: edition to the newsreporter config to get a morning paper here." />
    </div>;
  }
  return <PaperDesk key={reporter.id} reporter={reporter} reporters={reporters} routeDate={routeDate}
    onPickReporter={id => setSearchParams(params => {
      const next = new URLSearchParams(params);
      next.set('paper', id);
      return next;
    })} />;
}

function PaperDesk({ reporter, reporters, routeDate, onPickReporter }) {
  const [searchParams] = useSearchParams();
  const search = searchParams.toString() ? `?${searchParams}` : '';
  const routes = useMemo(() => paperRoutes(reporter.id), [reporter.id]);
  const today = localDateKey();
  const viewingDate = routeDate || today;
  const isBackIssue = Boolean(routeDate) && routeDate !== today;
  const title = reporter.title || 'The office paper';

  const editionsResource = useApiResource(routes.editions, { label: 'Paper back issues', dedupe: false });
  const summaries = useMemo(() => editionSummaries(editionsResource.data), [editionsResource.data]);
  const summary = summaries.find(row => row.date === viewingDate) || null;
  // Today's detail is read only when the list says it exists; a back issue
  // named in the URL is read even when it has scrolled out of the list.
  const wantDetail = editionsResource.hasResult && (Boolean(summary) || Boolean(routeDate));
  const detailResource = useApiResource(routes.edition(viewingDate), {
    label: 'Paper edition', dedupe: false, enabled: wantDetail,
  });
  const detailMissing = detailResource.error?.status === 404;
  const detail = detailResource.hasResult ? detailResource.data : null;
  const printersResource = useApiResource(routes.printers, { label: 'Paper printers', dedupe: false });
  const printers = useMemo(() => printerNames(printersResource.data), [printersResource.data]);

  const [busy, setBusy] = useState(null);
  const [preview, setPreview] = useState(null);
  const [choosingPrinter, setChoosingPrinter] = useState(false);
  const [printer, setPrinter] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const elapsed = useElapsedSeconds(Boolean(busy));
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    logger().info('paper.view', { reporterId: reporter.id, date: viewingDate, backIssue: isBackIssue });
  }, [reporter.id, viewingDate, isBackIssue]);

  // A preview belongs to the date it was composed for.
  useEffect(() => { setPreview(null); setChoosingPrinter(false); }, [viewingDate]);

  const hasEdition = Boolean(summary || detail) && !detailMissing;
  const version = summary?.composedAt || detail?.composedAt || '';
  useEffect(() => { setImageFailed(false); }, [viewingDate, version]);

  const dateBody = isBackIssue ? { date: viewingDate } : {};

  const refresh = () => {
    editionsResource.reload?.();
    if (wantDetail) detailResource.reload?.();
  };

  const act = async (action, request, onResult) => {
    const started = Date.now();
    setBusy(action);
    logger().info('paper.action.start', { action, reporterId: reporter.id, date: viewingDate, ...request.log });
    try {
      const result = await DaylightAPI(request.path, request.body, 'POST');
      logger().info('paper.action.complete', {
        action, reporterId: reporter.id, date: viewingDate, status: result?.status ?? null, ms: Date.now() - started,
      });
      if (mounted.current) onResult(result);
    } catch (error) {
      logger().warn('paper.action.error', {
        action, reporterId: reporter.id, date: viewingDate, error: error?.message, status: error?.status ?? null,
      });
      if (mounted.current) {
        notifications.show({ color: 'red', title: request.failTitle, message: error?.message || 'The server did not answer.' });
      }
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const print = (target = null) => act(target ? 'printTo' : 'print', {
    path: routes.deliver,
    body: { ...dateBody, ...(target ? { printer: target } : {}), force: true },
    log: { printer: target },
    failTitle: 'Print failed',
  }, result => {
    notifications.show(deliverOutcome(result?.status, target || result?.printer || null));
    setChoosingPrinter(false);
    refresh();
  });

  const compose = (action = 'compose') => act(action, {
    path: routes.compose,
    body: { ...dateBody },
    failTitle: 'Compose failed',
  }, result => {
    setPreview(null);
    const number = result?.number ?? result?.edition?.number;
    notifications.show({
      color: 'green',
      title: action === 'keep' ? 'Edition kept' : 'Recomposed',
      message: `${number != null ? `No. ${number} is` : 'The new edition is'} on the stand. Print it when you want it on paper.`,
    });
    refresh();
  });

  const runPreview = () => act('preview', {
    path: routes.compose,
    body: { ...dateBody, dryRun: true },
    failTitle: 'Preview failed',
  }, result => {
    const src = previewSource(result);
    if (!src) {
      logger().warn('paper.preview.no_image', { reporterId: reporter.id, date: viewingDate });
      notifications.show({ color: 'red', title: 'Preview failed', message: 'The preview came back without an image.' });
      return;
    }
    setPreview({ src, date: viewingDate });
  });

  const discardPreview = () => {
    logger().info('paper.preview.discard', { reporterId: reporter.id, date: viewingDate });
    setPreview(null);
  };

  const keepPreview = () => {
    logger().info('paper.preview.keep', { reporterId: reporter.id, date: viewingDate });
    compose('keep');
  };

  const status = busy
    ? `${BUSY_WORDS[busy]}… ${elapsed} s${SLOW_ACTIONS.has(busy) ? ' (usually a minute or two)' : ''}`
    : statusLine({ summary, detail: detailMissing ? null : detail, isBackIssue });
  const inputs = hasEdition ? inputsLine({ summary, detail }) : '';
  const stories = storyLinks(detail);
  const label = dateLabel(viewingDate);
  const number = summary?.number ?? detail?.number;
  const editionName = `${title}${number != null ? `, No. ${number}` : ''}, ${label}`;
  const showingPreview = preview?.date === viewingDate;
  const loadingEdition = !editionsResource.hasResult || (wantDetail && detailResource.loading && !detail);

  return (
    <div className="feed-paper">
      <section className="feed-paper__desk" aria-labelledby="feed-paper-title">
        <header className="feed-paper__header">
          <div>
            <h1 id="feed-paper-title">{title}</h1>
            <p className="feed-paper__date">{isBackIssue ? `Back issue · ${label}` : `Today · ${label}`}</p>
          </div>
          {reporters.length > 1 && (
            <label className="feed-paper__picker">
              <span>Paper</span>
              <Select density="compact" value={reporter.id} onChange={event => onPickReporter(event.target.value)}>
                {reporters.map(item => <option key={item.id} value={item.id}>{item.title || item.id}</option>)}
              </Select>
            </label>
          )}
        </header>

        <p className="feed-paper__status" role="status" aria-live="polite">{status}</p>
        {inputs && <p className="feed-paper__inputs">{inputs}</p>}

        <div className="feed-paper__actions" role="group" aria-label="Edition actions">
          {showingPreview ? <>
            <Button density="compact" onClick={keepPreview} busy={busy === 'keep'} disabled={Boolean(busy)}>Keep</Button>
            <Button density="compact" variant="secondary" onClick={discardPreview} disabled={Boolean(busy)}>Discard</Button>
          </> : <>
            <Button density="compact" onClick={() => print()} busy={busy === 'print'} disabled={Boolean(busy)}>
              {isBackIssue ? 'Reprint' : 'Print'}
            </Button>
            <Button density="compact" variant="secondary" aria-expanded={choosingPrinter}
              onClick={() => setChoosingPrinter(open => !open)} disabled={Boolean(busy) || !printers.length}>
              {isBackIssue ? 'Reprint to…' : 'Print to…'}
            </Button>
            <Button density="compact" variant="secondary" onClick={() => compose()} busy={busy === 'compose'} disabled={Boolean(busy)}>
              {hasEdition ? 'Recompose' : 'Compose'}
            </Button>
            <Button density="compact" variant="secondary" onClick={runPreview} busy={busy === 'preview'} disabled={Boolean(busy)}>
              Preview
            </Button>
          </>}
        </div>

        {choosingPrinter && !showingPreview && (
          <form className="feed-paper__printer" onSubmit={event => { event.preventDefault(); if (printer) print(printer); }}>
            <label>
              <span>Printer</span>
              <Select density="compact" value={printer} onChange={event => setPrinter(event.target.value)} autoFocus>
                <option value="" disabled>Choose a printer</option>
                {printers.map(name => <option key={name} value={name}>{name}</option>)}
              </Select>
            </label>
            <Button density="compact" type="submit" busy={busy === 'printTo'} disabled={!printer || Boolean(busy)}>
              {printer ? `Print on ${printer}` : 'Print'}
            </Button>
            <Button density="compact" variant="secondary" onClick={() => setChoosingPrinter(false)} disabled={Boolean(busy)}>Cancel</Button>
          </form>
        )}

        <div className="feed-paper__stage" aria-busy={Boolean(busy) || undefined}>
          {showingPreview ? (
            <figure className="feed-paper__sheet feed-paper__sheet--preview">
              <figcaption>Preview, not saved. Keep composes it for real; Discard throws it away.</figcaption>
              <img src={preview.src} alt={`Preview of ${title} for ${label}`} width={576} />
            </figure>
          ) : loadingEdition ? (
            <LoadingState label="the edition" rows={6} />
          ) : hasEdition ? (
            imageFailed ? (
              <p className="feed-paper__missing">The image for this edition could not be loaded. Recompose to make a new one.</p>
            ) : (
              <figure className="feed-paper__sheet">
                <img src={routes.image(viewingDate, version)} alt={editionName} width={576}
                  onError={() => {
                    logger().warn('paper.image.error', { reporterId: reporter.id, date: viewingDate });
                    setImageFailed(true);
                  }} />
              </figure>
            )
          ) : (
            <p className="feed-paper__missing">
              {isBackIssue
                ? 'There is no edition for this date.'
                : 'Today’s paper has not been written yet. Compose writes it now; Print writes it and prints it.'}
            </p>
          )}
        </div>

        {!showingPreview && stories.length > 0 && (
          <section className="feed-paper__stories" aria-labelledby="feed-paper-stories">
            <h2 id="feed-paper-stories">Stories in this edition</h2>
            <ol>
              {stories.map(story => (
                <li key={story.key}>
                  {story.links.map((link, index) => (
                    <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer"
                      className={index ? 'feed-paper__story-also' : undefined}>
                      <span>{link.title}</span>
                      {link.host && <small>{link.host}</small>}
                    </a>
                  ))}
                </li>
              ))}
            </ol>
          </section>
        )}
      </section>

      <nav className="feed-paper__issues" aria-label="Back issues">
        <h2>Back issues</h2>
        {isBackIssue && <Link className="feed-paper__today-link" to={`/feed/paper${search}`}>Back to today</Link>}
        {editionsResource.error && !editionsResource.hasResult ? (
          <ErrorState label="Back issues" error={editionsResource.error} onRetry={editionsResource.reload} />
        ) : !editionsResource.hasResult ? (
          <LoadingState label="back issues" />
        ) : summaries.length ? (
          <ol>
            {summaries.map(row => {
              const current = row.date === viewingDate;
              return (
                <li key={row.date}>
                  <Link to={row.date === today ? `/feed/paper${search}` : `/feed/paper/${row.date}${search}`}
                    aria-current={current ? 'page' : undefined}
                    className={`feed-paper__issue${current ? ' feed-paper__issue--current' : ''}`}
                    onClick={() => logger().debug('paper.issue.open', { reporterId: reporter.id, date: row.date })}>
                    <span className="feed-paper__issue-head">
                      <span>{shortDateLabel(row.date)}</span>
                      {row.number != null && <span>No. {row.number}</span>}
                    </span>
                    <span className="feed-paper__issue-lead">{row.leadHeadline || 'No lead headline'}</span>
                    <span className="feed-paper__issue-meta">{statusWord(row)} · {formatCost(row.costUsd)}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="feed-paper__missing">No editions yet.</p>
        )}
      </nav>
    </div>
  );
}
