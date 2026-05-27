import React, { useState, useEffect } from 'react';
import { Stack, Text } from '@mantine/core';
import ContentSearchCombobox from '../../ContentLists/ContentSearchCombobox';
import { titleCache } from '../utils/titleCache.js';

/**
 * LabeledContentPicker — thin wrapper around ContentSearchCombobox that
 * resolves the human-readable title of a content ID and renders it as a
 * dimmed label above the input.
 *
 * Implements the no-flicker pattern from the design doc:
 *  - Dropdown pick (onChange(id, item) with item.title present): we prime
 *    `titleCache[id] = item.title` AND set local `title` state directly —
 *    no refetch.
 *  - Freeform commit (onChange(search) with no item): clear local `title`
 *    and let the effect resolve via /api/v1/info/:source/:id.
 *  - Mount with `value` set and not in cache: fetch + populate cache,
 *    fail-soft on any error (label stays blank).
 *  - Cancel guard via local `cancelled` flag in the effect.
 *
 * @param {object} props
 * @param {string} props.value - the content ID, e.g. "plex:670208"
 * @param {(id: string, item?: object) => void} props.onChange
 * @param {string} [props.placeholder]
 */
export function LabeledContentPicker({ value, onChange, placeholder, ...rest }) {
  const [title, setTitle] = useState(() => titleCache.get(value) || null);

  // Resolve title on mount / value change when we don't already have one.
  useEffect(() => {
    if (!value || title) return;
    const cached = titleCache.get(value);
    if (cached) {
      setTitle(cached);
      return;
    }
    const [source, id] = value.split(':');
    if (!source || !id) return;
    let cancelled = false;
    fetch(`/api/v1/info/${encodeURIComponent(source)}/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const t = data?.title ?? null;
        if (t) titleCache.set(value, t);
        setTitle(t);
      })
      .catch(() => {
        /* fail-soft — leave label blank */
      });
    return () => {
      cancelled = true;
    };
  }, [value, title]);

  return (
    <Stack gap={4}>
      {title && <Text size="sm" c="dimmed">{title}</Text>}
      <ContentSearchCombobox
        value={value}
        placeholder={placeholder}
        onChange={(id, item) => {
          // Dropdown pick → prime cache + local state directly (no flicker).
          // Freeform commit → clear local state and let the effect re-resolve.
          if (item?.title) {
            titleCache.set(id, item.title);
            setTitle(item.title);
          } else {
            setTitle(null);
          }
          onChange(id, item);
        }}
        {...rest}
      />
    </Stack>
  );
}

export default LabeledContentPicker;
