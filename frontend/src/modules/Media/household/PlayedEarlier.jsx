// frontend/src/modules/Media/household/PlayedEarlier.jsx
// "Played earlier" in every screen's queue panel, local or remote (FIND.11a):
// that screen's plays, newest first, each with picture, title and the time it
// played — shuffled and "keep similar things playing" runs included, because
// every start is a ledger row (GET /api/v1/media/screens/:id/played-earlier).
// Each row has the same verbs as anywhere else, including favourites.
import React, { useEffect, useRef, useState } from 'react';
import { Button, Text, UnstyledButton } from '@mantine/core';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import mediaLog from '../logging/mediaLog.js';
import { playedEarlierPath } from './householdApi.js';
import { playedAtLabel, toItem } from './householdModel.js';
import { useFavourites, householdResourceLogger } from './useHousehold.js';
import { useItemVerbs } from './useItemVerbs.jsx';
import { ItemMenu } from './ItemMenu.jsx';
import './PlayedEarlier.scss';

const PAGE = 20;
const MAX = 200;
// A music queue moves on every few minutes; refresh at most this often.
export const REFRESH_MIN_MS = 60_000;

/**
 * @param {object} props
 * @param {string} props.screenId   this device's id (local) or the remote screen's id
 * @param {string|null} [props.currentContentId] refetch when the screen moves on
 */
export function PlayedEarlier({ screenId, currentContentId = null }) {
  const [limit, setLimit] = useState(PAGE);
  const path = screenId ? playedEarlierPath(screenId, { limit }) : null;
  const { data, loading, error, reload } = useApiResource(path, {
    swr: true, label: 'media-played-earlier', logger: householdResourceLogger,
  });
  // When the screen moves on, what it played becomes "earlier" — refresh,
  // but not on every track of a music queue.
  const lastRefreshRef = useRef(Date.now());
  const firstItemRef = useRef(currentContentId);
  const trailingRef = useRef(null);
  useEffect(() => {
    if (currentContentId === firstItemRef.current) return;
    firstItemRef.current = currentContentId;
    const now = Date.now();
    const wait = lastRefreshRef.current + REFRESH_MIN_MS - now;
    if (trailingRef.current) { clearTimeout(trailingRef.current); trailingRef.current = null; }
    if (wait > 0) {
      // Inside the window: refresh when it ends, so the last change is not lost.
      trailingRef.current = setTimeout(() => {
        trailingRef.current = null;
        lastRefreshRef.current = Date.now();
        reload();
      }, wait);
      return;
    }
    lastRefreshRef.current = now;
    reload();
  }, [currentContentId, reload]);
  useEffect(() => () => { if (trailingRef.current) clearTimeout(trailingRef.current); }, []);
  const favourites = useFavourites();
  const { run, overlays } = useItemVerbs();
  const items = Array.isArray(data?.items) ? data.items : [];

  useEffect(() => {
    if (data) mediaLog.playedEarlierShown({ screenId, count: items.length, limit });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!screenId) return null;
  return (
    <section className="played-earlier" data-testid="played-earlier" aria-labelledby="played-earlier-title">
      <Text component="h3" className="played-earlier-title" id="played-earlier-title">Played earlier</Text>
      {loading && !data && <Text size="sm" c="dimmed" data-testid="played-earlier-loading">Loading…</Text>}
      {error && !data && (
        <Text size="sm" c="dimmed" data-testid="played-earlier-error">
          Couldn&apos;t load what played earlier.{' '}
          <Button size="compact-sm" variant="subtle" onClick={reload}>Try again</Button>
        </Text>
      )}
      {data && items.length === 0 && (
        <Text size="sm" c="dimmed" data-testid="played-earlier-empty">Nothing has played here yet.</Text>
      )}
      {items.length > 0 && (
        <ul className="played-earlier-list">
          {items.map((row, index) => {
            const item = toItem({ ...row, kind: 'item' });
            if (!item) return null;
            const testId = `played-earlier-${index}`;
            const context = [row.grandparentTitle, playedAtLabel(row.startedAt ?? row.localTime)].filter(Boolean).join(' · ');
            return (
              <li key={`${row.contentId}-${row.startedAt}`} className="played-earlier-row" data-testid={testId} data-content-id={row.contentId}>
                <UnstyledButton
                  className="played-earlier-main"
                  data-testid={`${testId}-play`}
                  aria-label={`Play ${row.title ?? 'this'}`}
                  onClick={() => run('tap', item)}
                >
                  {row.thumbnail
                    ? <img className="played-earlier-thumb" src={row.thumbnail} alt="" loading="lazy" />
                    : <span className="played-earlier-thumb" aria-hidden />}
                  <span className="played-earlier-text">
                    <span className="played-earlier-name">{row.title ?? 'Untitled'}</span>
                    <span className="played-earlier-meta" data-testid={`${testId}-when`}>{context}</span>
                  </span>
                </UnstyledButton>
                <ItemMenu item={item} onVerb={kind => run(kind, item)} favourite={favourites.has(item.id)} testId={testId} />
              </li>
            );
          })}
        </ul>
      )}
      {items.length >= limit && limit < MAX && (
        <Button variant="subtle" color="gray" size="sm" data-testid="played-earlier-more"
          onClick={() => setLimit(value => Math.min(MAX, value + PAGE))}>
          Show more
        </Button>
      )}
      {overlays}
    </section>
  );
}

export default PlayedEarlier;
