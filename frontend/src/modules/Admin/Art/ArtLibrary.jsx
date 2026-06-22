import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TextInput, Group, Switch, Badge, Button } from '@mantine/core';
import getLogger from '../../../lib/logging/Logger.js';
import { useAdminConfig } from '../../../hooks/admin/useAdminConfig.js';
import { useArtCuration } from './useArtCuration.js';
import { keyToAction } from './keymap.js';
import Loupe from './Loupe.jsx';
import GridView from './GridView.jsx';
import ArtErrorBoundary from './ArtErrorBoundary.jsx';
import './Art.scss';

// Toggle a value in/out of an array immutably.
const toggle = (arr = [], v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

export default function ArtLibrary() {
  const logger = useMemo(() => getLogger().child({ component: 'admin-art-library' }), []);
  const [filters, setFilters] = useState({});
  const [view, setView] = useState('loupe');   // 'loupe' | 'grid'
  const [editMode, setEditMode] = useState(false);
  const [saved, setSaved] = useState(false);
  const searchRef = useRef(null);

  const cfg = useAdminConfig('household/config/art.yml');
  useEffect(() => { cfg.load?.(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const quickTags = cfg.data?.quickTags || [];

  const {
    works, focused, index, loading, autoAdvance,
    setAutoAdvance, next, prev, goto, mutate, undo,
  } = useArtCuration(filters);

  const flash = useCallback(() => { setSaved(true); setTimeout(() => setSaved(false), 800); }, []);

  // The collection the list is currently filtered to (for remove-from-collection).
  const currentCollection = filters.tag || null;

  // Set the crop anchor (clickable compass, or numpad). 'center' stays explicit.
  const setAnchor = useCallback(async (value) => {
    await mutate({ crop_anchor: value });
    flash();
  }, [mutate, flash]);

  const setCrop = useCallback(async (crop) => {
    await mutate({ crop });
    flash();
  }, [mutate, flash]);

  const onAction = useCallback(async (a) => {
    if (!a) return;
    // Logged at info so every action is visible in prod logs (not just debug) —
    // makes a failing keystroke traceable end-to-end.
    logger.info('art.action', { action: a.action, tag: a.tag ?? null, value: a.value ?? null });
    try {
      switch (a.action) {
        case 'next': return next();
        case 'prev': return prev();
        case 'toggleView': return setView((v) => (v === 'loupe' ? 'grid' : 'loupe'));
        case 'focusSearch': return searchRef.current?.focus();
        case 'autoAdvance': return setAutoAdvance((v) => !v);
        case 'undo': await undo(); return flash();
        case 'edit': return setEditMode(true);
        case 'exitEdit': return setEditMode(false);
        case 'palette': return searchRef.current?.focus();   // P1: palette = focus tag filter; richer palette later
        case 'toggleHidden':
          await mutate({ hidden: !focused?.meta?.hidden }); return flash();
        case 'toggleFlagged':
          await mutate({ flagged: !focused?.meta?.flagged }); return flash();
        case 'toggleTag':
          await mutate({ tags: toggle(focused?.meta?.tags, a.tag) }); return flash();
        case 'anchor':
          return setAnchor(a.value);
        case 'removeFromCollection': {
          if (!currentCollection || !focused) return undefined;
          const meta = focused.meta || {};
          if ((meta.tags || []).includes(currentCollection)) {
            await mutate({ tags: meta.tags.filter((t) => t !== currentCollection) });
          } else {
            await mutate({ exclude: [...(meta.exclude || []), currentCollection] });
          }
          return flash();
        }
        default: return undefined;
      }
    } catch (err) {
      logger.error('art.action.error', { action: a.action, message: err?.message, stack: err?.stack });
      return undefined;
    }
  }, [next, prev, setAutoAdvance, undo, flash, mutate, setAnchor, focused, currentCollection, logger]);

  // Global keydown → keymap → action. Ignore when typing in an input unless it's Escape.
  // Wrapped so a thrown handler logs a stack instead of vanishing as an uncaught error.
  useEffect(() => {
    const onKey = (e) => {
      try {
        const inField = e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA';
        const a = keyToAction(e, { quickTags, editMode: editMode || inField });
        if (!a) return;
        e.preventDefault();
        Promise.resolve(onAction(a)).catch((err) =>
          logger.error('art.action.crash', { action: a.action, message: err?.message, stack: err?.stack }));
      } catch (err) {
        logger.error('art.key.crash', { key: e?.key, message: err?.message, stack: err?.stack });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [quickTags, editMode, onAction, logger]);

  // Capture any uncaught error / rejection while the Library is open, with a stack.
  useEffect(() => {
    const onErr = (ev) => logger.error('art.window.error', {
      message: ev?.message, source: ev?.filename, line: ev?.lineno, col: ev?.colno, stack: ev?.error?.stack,
    });
    const onRej = (ev) => logger.error('art.window.unhandledrejection', {
      message: ev?.reason?.message ?? String(ev?.reason), stack: ev?.reason?.stack,
    });
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => {
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
    };
  }, [logger]);

  useEffect(() => { logger.info('art.library.mount', {}); }, [logger]);

  return (
    <div className="art-library">
      <Group className="art-library__bar" gap="sm">
        {/* Capture the event value SYNCHRONOUSLY before the functional updater —
            React nulls e.currentTarget once the handler returns, but the updater
            runs later during reconciliation (the "reading 'value' of null" crash). */}
        <TextInput
          ref={searchRef} size="xs" placeholder="search title / artist…"
          value={filters.q || ''}
          onChange={(e) => { const v = e.currentTarget.value; setFilters((f) => ({ ...f, q: v })); }}
        />
        <TextInput
          size="xs" placeholder="filter tag / collection…"
          value={filters.tag || ''}
          onChange={(e) => { const v = e.currentTarget.value; setFilters((f) => ({ ...f, tag: v })); }}
        />
        <Switch size="xs" label="hidden" checked={!!filters.hidden}
          onChange={(e) => { const on = e.currentTarget.checked; setFilters((f) => ({ ...f, hidden: on ? 'true' : '' })); }} />
        <Switch size="xs" label="flagged" checked={!!filters.flagged}
          onChange={(e) => { const on = e.currentTarget.checked; setFilters((f) => ({ ...f, flagged: on ? 'true' : '' })); }} />
        <Switch size="xs" label="auto-advance" checked={autoAdvance}
          onChange={(e) => setAutoAdvance(e.currentTarget.checked)} />
        <Badge size="sm" variant="light">{works.length} works</Badge>
        <Button size="xs" variant="default"
          onClick={() => setView((v) => (v === 'loupe' ? 'grid' : 'loupe'))}>
          {view === 'loupe' ? 'Grid' : 'Loupe'} (Enter)
        </Button>
      </Group>

      <div className="art-library__legend">
        ←/→ cycle · Enter grid/loupe · click image region (or numpad) sets crop anchor
        {quickTags.length ? ` · 1–${quickTags.length} quick-tag` : ''} · X hide · F flag · E edit · A auto-advance · U undo
      </div>

      <ArtErrorBoundary>
        {loading ? <div className="art-library__loading">Loading…</div>
          : view === 'loupe'
            ? <Loupe work={focused} total={works.length} index={index} saved={saved} onAnchor={setAnchor} onCrop={setCrop} />
            : <GridView works={works} index={index} onPick={(i) => { goto(i); setView('loupe'); }} />}
      </ArtErrorBoundary>
    </div>
  );
}
