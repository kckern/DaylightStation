import { useEffect, useRef } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import { newTake, addEvent, qualified, silent, takeKey, flushBody } from './autoHistory.js';

/**
 * useAutoMidiHistory — always-on capture of the live Web-MIDI stream into
 * silence/player-segmented .mid files, attributed to the current player.
 *
 * Buffers events into a take; once it crosses minNotes/minSeconds it gets a
 * stable start-time id and is flushed (full-state, idempotent PUT) every
 * flushSeconds. A silence gap or a player change closes the take (final flush);
 * sub-threshold takes are dropped. Disabled unless config.enabled.
 *
 * @param {Function} subscribe   from usePianoMidi() — stable ref, stable unsub
 * @param {string}   currentUser 'guest' or a roster id
 * @param {object}   config      resolved piano config .autoRecord
 */
export function useAutoMidiHistory(subscribe, currentUser, config) {
  const logger = useRef(null);
  if (!logger.current) logger.current = getLogger().child({ component: 'piano-auto-history' });

  const cfgRef = useRef(config); cfgRef.current = config;
  const userRef = useRef(currentUser); // read live inside the stable subscription
  const takeRef = useRef(null);
  const usedKeys = useRef(new Set());
  const flushedAtRef = useRef(0);

  // PUT the current take (full state) to the history endpoint. Idempotent.
  const flush = (take, nowMs, { final = false } = {}) => {
    if (!take) return;
    const key = take.key || takeKey(take.date, take.id, usedKeys.current);
    take.key = key; // mutate the ref'd object directly so addEvent spreads don't lose it
    usedKeys.current.add(`${take.date}/${key}`);
    const body = flushBody(take, nowMs);
    DaylightAPI(`api/v1/piano/users/${encodeURIComponent(take.owner)}/history/${take.date}/${key}`, body, 'PUT')
      .then(() => logger.current.info('piano.history.flush', { owner: take.owner, key, final, events: body.events.length }))
      .catch((e) => logger.current.warn('piano.history.flush.fail', { owner: take.owner, key, error: e?.message }));
  };

  const closeCurrent = (nowMs) => {
    const take = takeRef.current;
    takeRef.current = null;
    if (take && qualified(take, cfgRef.current)) flush(take, nowMs, { final: true });
  };

  // Subscribe to the live note stream (mounted once; reads userRef live).
  useEffect(() => {
    if (!config?.enabled) return undefined;
    const unsub = subscribe((evt) => {
      if (!takeRef.current) takeRef.current = newTake(Date.now(), userRef.current || 'guest');
      takeRef.current = addEvent(takeRef.current, evt);
    });
    return () => { unsub?.(); closeCurrent(Date.now()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.enabled, subscribe]);

  // Poll: silence-close + periodic flush.
  useEffect(() => {
    if (!config?.enabled) return undefined;
    const id = setInterval(() => {
      const now = Date.now();
      const take = takeRef.current;
      if (!take) return;
      if (silent(take, now, (cfgRef.current.silenceSeconds || 25) * 1000)) {
        closeCurrent(now);          // qualified → final flush; else dropped
        return;
      }
      if (qualified(take, cfgRef.current) && now - flushedAtRef.current >= (cfgRef.current.flushSeconds || 12) * 1000) {
        flushedAtRef.current = now;
        flush(take, now);
      }
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.enabled]);

  // Player change: close the open take under the OLD owner, then re-point.
  useEffect(() => {
    if (!config?.enabled) return;
    if (takeRef.current && takeRef.current.owner !== currentUser) closeCurrent(Date.now());
    userRef.current = currentUser;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, config?.enabled]);
}

export default useAutoMidiHistory;
