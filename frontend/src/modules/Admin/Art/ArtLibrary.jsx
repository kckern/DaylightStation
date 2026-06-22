import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TextInput, Group, Switch, Badge } from '@mantine/core';
import getLogger from '../../../lib/logging/Logger.js';
import { useAdminConfig } from '../../../hooks/admin/useAdminConfig.js';
import { useArtCuration } from './useArtCuration.js';
import { keyToAction } from './keymap.js';
import Loupe from './Loupe.jsx';
import GridView from './GridView.jsx';
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

  const onAction = useCallback(async (a) => {
    if (!a) return;
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
        await mutate({ crop_anchor: a.value }); return flash();
      case 'removeFromCollection': {
        if (!currentCollection || !focused) return;
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
  }, [next, prev, setAutoAdvance, undo, flash, mutate, focused, currentCollection]);

  // Global keydown → keymap → action. Ignore when typing in an input unless it's Escape.
  useEffect(() => {
    const onKey = (e) => {
      const inField = e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA';
      const a = keyToAction(e, { quickTags, editMode: editMode || inField });
      if (!a) return;
      e.preventDefault();
      onAction(a);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [quickTags, editMode, onAction]);

  useEffect(() => { logger.info('art.library.mount', {}); }, [logger]);

  return (
    <div className="art-library">
      <Group className="art-library__bar" gap="sm">
        <TextInput
          ref={searchRef} size="xs" placeholder="search title / artist…"
          value={filters.q || ''}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.currentTarget.value }))}
        />
        <TextInput
          size="xs" placeholder="filter tag / collection…"
          value={filters.tag || ''}
          onChange={(e) => setFilters((f) => ({ ...f, tag: e.currentTarget.value }))}
        />
        <Switch size="xs" label="hidden" checked={!!filters.hidden}
          onChange={(e) => setFilters((f) => ({ ...f, hidden: e.currentTarget.checked ? 'true' : '' }))} />
        <Switch size="xs" label="flagged" checked={!!filters.flagged}
          onChange={(e) => setFilters((f) => ({ ...f, flagged: e.currentTarget.checked ? 'true' : '' }))} />
        <Switch size="xs" label="auto-advance" checked={autoAdvance}
          onChange={(e) => setAutoAdvance(e.currentTarget.checked)} />
        <Badge size="sm" variant="light">{works.length} works</Badge>
      </Group>

      {loading ? <div className="art-library__loading">Loading…</div>
        : view === 'loupe'
          ? <Loupe work={focused} total={works.length} index={index} saved={saved} />
          : <GridView works={works} index={index} onPick={(i) => { goto(i); setView('loupe'); }} />}
    </div>
  );
}
