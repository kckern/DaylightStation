// ContentCombobox.jsx — the unified content combobox presentation component.
// Single implementation replacing BOTH legacy comboboxes:
//   - ContentSearchCombobox.jsx (standalone): Mantine skeleton, freeform row,
//     resolved-title line, pending-sources/source-errors strips, breadcrumb bar,
//     clear button, scroll-edge pagination.
//   - the inline twin in ListsItemRow.jsx: fully-owned keyboard model (machine
//     holds highlight), select-after-colon open behavior, isCurrent bolding,
//     eased scroll-to-highlight with pac-man wrap flash.
// All state transitions live in comboboxMachine.js; all side effects live in
// useContentCombobox.js. This file is presentation + DOM-only concerns (focus,
// selection ranges, scroll positioning).
//
// Deliberate omissions (unified design, see 2026-07-09 audit):
//   - parent-subtitle click navigation (§3.1-8 — mouse-only bad affordance)
//   - tier-2 "Search all sources" row (SSE stream covers all sources)
//   - app-param picker and ItemDetailsDrawer (stay in ListsItemRow, Task 13)
//   - result grouping by `group` field (index-owned highlight requires DOM
//     order === items order; no current search transport emits `group`)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Combobox, TextInput, ScrollArea, Group, Text, Avatar, Badge, Loader,
  Stack, ActionIcon, Box, useCombobox,
} from '@mantine/core';
import {
  IconSearch, IconChevronRight, IconArrowLeft, IconFolder,
  IconMusic, IconVideo, IconPhoto, IconFile, IconList, IconPencil, IconX,
} from '@tabler/icons-react';
import { getChildLogger } from '../../../../lib/logging/singleton.js';
import { shouldRunScrollToHighlighted, computeScrollRestore, shouldPositionLevel } from '../comboboxScroll.js';
import { useContentCombobox } from './useContentCombobox.js';
import { Modes, isContainer } from './comboboxMachine.js';
import './ContentCombobox.scss';

const TYPE_ICONS = {
  show: IconVideo,
  movie: IconVideo,
  episode: IconVideo,
  video: IconVideo,
  track: IconMusic,
  album: IconMusic,
  artist: IconMusic,
  audio: IconMusic,
  photo: IconPhoto,
  image: IconPhoto,
  folder: IconFolder,
  channel: IconList,
  series: IconFolder,
  conference: IconFolder,
  playlist: IconList,
  default: IconFile,
};

const SOURCE_ICONS = {
  plex: '🎬',
  immich: '📷',
  audiobookshelf: '📚',
  singalong: '🎵',
  media: '📁',
  default: '🔍',
};

const OPTION_CLASS = 'content-combobox-option';

function getIcon(item) {
  const type = item.type || item.metadata?.type || item.mediaType;
  const Icon = TYPE_ICONS[type] || TYPE_ICONS.default;
  return <Icon size={16} />;
}

const normalizeValue = (v) => v?.replace(/:\s+/g, ':');

/** Option top relative to the scroll viewport (offsetParent-independent). */
function optionTopIn(viewport, option) {
  return option.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
}

/**
 * ContentCombobox — unified searchable/browsable content picker.
 *
 * @param {object} props
 * @param {string} props.value - committed content id ('' when unset)
 * @param {(id: string, item?: object) => void} props.onChange
 * @param {string} [props.placeholder]
 * @param {boolean} [props.selectContainers] - rows select containers; chevron ActionIcon browses
 * @param {string} [props.searchParams] - passthrough to the hook's search endpoints
 * @param {boolean} [props.appResults] - passthrough: merge app-registry matches
 * @param {(args: {onStartEdit: () => void, value: string, resolvedTitle: ?string}) => JSX} [props.renderValue]
 *   - when provided, rendered INSTEAD of the TextInput while in DISPLAY mode
 *     (lets callers keep rich display cards; clicking must call onStartEdit)
 */
export function ContentCombobox({
  value,
  onChange,
  placeholder = 'Search content...',
  selectContainers = false,
  searchParams = '',
  appResults = false,
  renderValue = null,
}) {
  const log = useMemo(() => getChildLogger({ component: 'ContentCombobox', app: 'admin', sessionLog: true }), []);
  const {
    state, dispatch,
    handleInput, activeScope, clearScope,
    openWithSiblings, drill, goUp, goToCrumb, paginate,
    handleClose, select, commit,
    resolvedTitle, isSearching, pendingSources, sourceErrors, truncatedAt,
  } = useContentCombobox({ value, onChange, searchParams, appResults, selectContainers });

  const mode = state.mode;
  const isBrowse = mode === Modes.BROWSE;
  const isEditing = mode !== Modes.DISPLAY;
  const items = isBrowse ? state.browse.items : state.results;
  const search = state.search;
  const breadcrumbs = state.browse.breadcrumbs;
  const pagination = state.browse.pagination;
  const browseLoading = state.browse.loading;
  const highlightIdx = state.highlight.idx;
  const normalizedValue = normalizeValue(value);

  const inputRef = useRef(null);
  const viewportRef = useRef(null);
  const prevIdxRef = useRef(-1);
  const scrollAnimRef = useRef(null);
  const paginationScrollGuardRef = useRef(false); // suppress scroll-to-highlight after load-more
  const loadCooldownRef = useRef(false);          // ignore scroll events briefly after load-more
  const [loadingMore, setLoadingMore] = useState(false);

  // Machine mode, readable from Mantine callbacks without a stale closure.
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // ── Mantine store: dropdown visibility follows the machine mode ──
  const combobox = useCombobox({
    onDropdownClose: () => {
      combobox.resetSelectedOption();
      // Mantine-initiated close (outside pointerdown). When WE initiated the
      // close (Escape/Tab/select/freeform), the machine is already back in
      // DISPLAY and commit semantics were handled — do nothing.
      if (modeRef.current !== Modes.DISPLAY) commit('outside');
    },
  });

  useEffect(() => {
    if (isEditing) combobox.openDropdown();
    else combobox.closeDropdown();
  }, [isEditing]); // eslint-disable-line react-hooks/exhaustive-deps -- combobox store is stable

  // ── Open behavior (twin): seed input from value + select-after-colon ──
  const startEditing = useCallback(() => {
    if (modeRef.current !== Modes.DISPLAY) return;
    log.info('editing.start', { value });
    openWithSiblings();
    const q = value || '';
    // Select the part after the colon so typing replaces just the local id
    // (e.g. "147" in "hymn: 147") while keeping the source prefix.
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      if (renderValue) el.focus();
      const colonIdx = q.indexOf(':');
      if (colonIdx >= 0) {
        const selStart = q[colonIdx + 1] === ' ' ? colonIdx + 2 : colonIdx + 1;
        el.setSelectionRange(selStart, q.length);
      } else if (q) {
        el.select();
      }
    });
  }, [value, openWithSiblings, renderValue, log]);

  // ── Explicit raw commit (freeform-row path only) ──
  // The user explicitly chose the "Use … as raw value" row, so we save the RAW
  // string unconditionally — NO resolution, no warn toast. This deliberately
  // bypasses commit('enter')/decideCommit. We call onChange directly and close
  // via the hook with reason 'select' — closeDecision('select') is a no-op
  // commit, so there is no double-fire.
  const commitExplicitRaw = useCallback(() => {
    const text = search;
    if (!text) return;
    log.info('freeform.commit_via_option', { freeformValue: text, prevValue: value });
    onChange(text);
    handleClose('select');
  }, [search, value, onChange, handleClose, log]);

  // ── Option submit (mouse path; keyboard is fully component-owned) ──
  const handleOptionSubmit = (val) => {
    if (val === '__freeform__') {
      commitExplicitRaw();
      return;
    }
    const item = items.find((r) => r.id === val);
    if (!item) return;
    if (isContainer(item) && !selectContainers) drill(item);
    else select(item);
  };

  // ── Keyboard model (twin): the machine owns highlight; Mantine nav disabled ──
  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      dispatch({ type: 'ARROW', dir: e.key === 'ArrowDown' ? 1 : -1, itemCount: items.length });
      return;
    }
    if (e.key === 'ArrowRight') {
      const item = items[highlightIdx];
      if (item && isContainer(item)) {
        e.preventDefault();
        log.debug('key.arrow_right.drill', { contentId: item.id });
        drill(item);
      }
      // not a container — let the cursor move
      return;
    }
    if (e.key === 'ArrowLeft') {
      if (e.target.selectionStart === 0 || isBrowse) {
        e.preventDefault();
        goUp();
      }
      // otherwise let the cursor move
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commit('enter');   // decideCommit owns pick/render/literal/open; may keep the dropdown open
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      commit('escape');
      return;
    }
    if (e.key === 'Tab') {
      commit('tab'); // no preventDefault — focus moves naturally
    }
  };

  // ── Scroll-edge pagination (hook owns in-flight/owner guards) ──
  const runPaginate = async (direction) => {
    setLoadingMore(true);
    // Arm the scroll-suppression guard BEFORE the hook can dispatch PAGINATED;
    // disarm if the hook reports it didn't dispatch (guard would otherwise
    // leak and swallow the next arrow-navigation scroll).
    paginationScrollGuardRef.current = true;
    const viewport = viewportRef.current;
    const prevScrollHeight = direction === 'before' ? (viewport?.scrollHeight || 0) : 0;
    const prevScrollTop = direction === 'before' ? (viewport?.scrollTop || 0) : 0;
    try {
      const dispatched = await paginate(direction);
      if (!dispatched) paginationScrollGuardRef.current = false;
      if (dispatched && direction === 'before' && viewport) {
        // Maintain scroll position after prepending. overflowAnchor:none disables
        // native scroll-anchoring, so this manual restore is the only safeguard.
        // Double-rAF (mirroring the cooldown below) defers the write until AFTER
        // React commits the prepended rows + browser layout — a single rAF can
        // fire while scrollHeight is still stale, under-compensating and yanking
        // the viewport upward.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!viewport) return;
            viewport.scrollTop = computeScrollRestore({
              prevScrollHeight,
              newScrollHeight: viewport.scrollHeight,
              prevScrollTop,
            });
          });
        });
      }
    } finally {
      setLoadingMore(false);
      // Cooldown: appended items shift scroll position, which would re-trigger
      // onScrollPositionChange in a feedback loop.
      loadCooldownRef.current = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { loadCooldownRef.current = false; });
      });
    }
  };

  const handleScrollPosition = ({ y }) => {
    if (!isBrowse || !pagination || loadingMore || loadCooldownRef.current) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const { scrollHeight, clientHeight } = viewport;
    if (pagination.hasAfter && scrollHeight - y - clientHeight < 50) runPaginate('after');
    if (pagination.hasBefore && y < 50) runPaginate('before');
  };

  // ── Initial browse positioning: the FIRST render where a browse level
  // presents its reference row (highlight idx >= 0) with items rendered,
  // place that row ~1.5 rows from the top. Positions ONCE per level
  // (positionedLevelRef) so pagination load-more and user arrow-nav never
  // yank the viewport back. Retries across a few frames because on the
  // dropdown-open sequence the ScrollArea viewport / target option node may
  // not be laid out on the first frame (that timing gap could leave the list
  // pinned at scrollTop 0, hiding the selected item).
  const levelKey = isBrowse ? `b:${breadcrumbs.map((b) => b.id).join('>')}` : null;
  const positionedLevelRef = useRef(null);
  useEffect(() => {
    if (levelKey == null) { positionedLevelRef.current = null; return undefined; }

    const decision = shouldPositionLevel({
      levelKey,
      positionedLevel: positionedLevelRef.current,
      highlightIdx,
      itemsLength: items.length,
    });
    if (!decision.run) return undefined;

    // Reset the navigation writer's prev-index so it hits its 'initial-render'
    // guard and defers to us for this level's first placement (prevents a
    // cross-level drill misreading as a pac-man wrap: bogus wrap-flash + jump).
    prevIdxRef.current = -1;

    let rafId;
    let tries = 0;
    const attempt = () => {
      const viewport = viewportRef.current;
      const option = viewport?.querySelectorAll(`.${OPTION_CLASS}`)[highlightIdx];
      if (viewport && option && option.offsetHeight > 0) {
        viewport.scrollTop = Math.max(0, optionTopIn(viewport, option) - option.offsetHeight * 1.5);
        positionedLevelRef.current = levelKey;
        return;
      }
      if (tries++ < 6) rafId = requestAnimationFrame(attempt);
    };
    rafId = requestAnimationFrame(attempt);
    return () => { if (rafId) cancelAnimationFrame(rafId); };
  }, [levelKey, highlightIdx, items.length]); // eslint-disable-line react-hooks/exhaustive-deps -- once per level via positionedLevelRef

  // ── Scroll-to-highlighted: ONE writer. Eased snap on navigation, instant
  // jump + wrap-flash on pac-man wrap, skip entirely during pagination. ──
  useEffect(() => {
    if (scrollAnimRef.current) cancelAnimationFrame(scrollAnimRef.current);

    const decision = shouldRunScrollToHighlighted({
      highlightedIdx: highlightIdx,
      prevIdx: prevIdxRef.current,
      paginationInFlight: paginationScrollGuardRef.current,
    });

    if (decision.reason === 'pagination') {
      paginationScrollGuardRef.current = false;
      prevIdxRef.current = highlightIdx;
      return undefined;
    }
    if (!decision.run) {
      prevIdxRef.current = highlightIdx;
      return undefined;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      prevIdxRef.current = highlightIdx;
      return undefined;
    }
    const option = viewport.querySelectorAll(`.${OPTION_CLASS}`)[highlightIdx];
    if (!option) {
      prevIdxRef.current = highlightIdx;
      return undefined;
    }

    const prevIdx = prevIdxRef.current;
    const itemCount = items.length;
    const isWrap = (prevIdx === itemCount - 1 && highlightIdx === 0)
      || (prevIdx === 0 && highlightIdx === itemCount - 1);

    if (isWrap) {
      // Instant jump — no animation — then flash to draw the eye.
      viewport.scrollTop = highlightIdx === 0 ? 0 : viewport.scrollHeight - viewport.clientHeight;
      option.classList.add('wrap-flash');
      const onEnd = () => { option.classList.remove('wrap-flash'); option.removeEventListener('animationend', onEnd); };
      option.addEventListener('animationend', onEnd);
    } else {
      // Reserve ~2.5 rows of padding at the top so the item isn't jammed
      // against the dropdown header (breadcrumb / pending strip).
      const headerPad = option.offsetHeight * 2.5;
      const optTop = optionTopIn(viewport, option);
      const optBot = optTop + option.offsetHeight;
      const visTop = viewport.scrollTop;
      const visBot = visTop + viewport.clientHeight;

      let target = null;
      if (optTop < visTop + headerPad) target = Math.max(0, optTop - headerPad);
      else if (optBot > visBot) target = optBot - viewport.clientHeight;

      if (target !== null) {
        const start = viewport.scrollTop;
        const delta = target - start;
        const duration = 120;
        const t0 = performance.now();
        const step = (now) => {
          const p = Math.min((now - t0) / duration, 1);
          const ease = 1 - (1 - p) * (1 - p); // ease-out quad
          viewport.scrollTop = start + delta * ease;
          if (p < 1) scrollAnimRef.current = requestAnimationFrame(step);
        };
        scrollAnimRef.current = requestAnimationFrame(step);
      }
    }

    prevIdxRef.current = highlightIdx;
    return () => {
      if (scrollAnimRef.current) cancelAnimationFrame(scrollAnimRef.current);
    };
  }, [highlightIdx, items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Option row (standalone renderer + twin highlight/current classes) ──
  const renderOption = (item, idx) => {
    const container = isContainer(item);
    const source = item.source || item.id?.split(':')[0];
    const type = item.type || item.metadata?.type || item.mediaType;
    const parentTitle = item.parent || item.parentTitle || item.metadata?.parentTitle;
    const localId = item.localId || (source ? item.id?.replace(`${source}:`, '') : item.id);
    const childCount = item.childCount ?? item.metadata?.childCount ?? item.itemCount ?? null;
    const itemIndex = item.itemIndex ?? item.metadata?.itemIndex;
    const TypeIcon = TYPE_ICONS[type] || TYPE_ICONS.default;
    const isCurrent = normalizeValue(item.id) === normalizedValue;
    const isHighlighted = idx === highlightIdx;

    // Subtitle: type label with optional index, then parent.
    // NOTE: parent-subtitle click navigation deliberately dropped (§3.1-8).
    const typeLabel = type ? type.charAt(0).toUpperCase() + type.slice(1) : null;
    const indexedLabel = typeLabel && itemIndex != null ? `${typeLabel} ${itemIndex}` : typeLabel;
    const parts = [indexedLabel, parentTitle].filter(Boolean);
    const subtitleText = parts.length > 0 ? parts.join(' • ') : localId;

    const classNames = [OPTION_CLASS];
    if (isHighlighted) classNames.push('highlighted');
    if (isCurrent) classNames.push('current');

    return (
      <Combobox.Option
        key={item.id}
        value={item.id}
        data-testid={`combobox-option-${item.id}`}
        data-value={item.id}
        data-highlighted={isHighlighted ? 'true' : 'false'}
        data-current={isCurrent ? 'true' : 'false'}
        data-container={container ? 'true' : 'false'}
        className={classNames.join(' ')}
      >
        <Group gap="sm" wrap="nowrap" justify="space-between">
          <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
            <Avatar size="sm" src={item.thumbnail || item.imageUrl} radius="sm">
              {getIcon(item)}
            </Avatar>
            <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
              <Group gap={4} wrap="nowrap">
                <Text size="sm" truncate fw={isCurrent ? 600 : 500}>{item.title}</Text>
                {childCount != null && (
                  <Badge size="xs" variant="filled" color="gray" style={{ flexShrink: 0 }}>{childCount}</Badge>
                )}
              </Group>
              <Group gap={4} wrap="nowrap">
                <TypeIcon size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
                <Text size="xs" c="dimmed" truncate>{subtitleText}</Text>
              </Group>
            </Stack>
          </Group>
          <Group gap="xs" wrap="nowrap">
            {isCurrent && (
              <Badge
                size="xs"
                variant="light"
                color="teal"
                data-testid="combobox-current-badge"
                title="This is your current selection"
                style={{ flexShrink: 0 }}
              >
                Current
              </Badge>
            )}
            <Badge size="xs" variant="light" color="gray" data-testid="combobox-source-badge">{(source ?? '?').toUpperCase()}</Badge>
            {item.matchReason === 'id-lookup' && (
              <Badge
                size="xs"
                variant="light"
                color="gray"
                data-testid="match-reason-id"
                title="Matched by content ID, not text"
              >
                ID
              </Badge>
            )}
            {container && !selectContainers && (
              <IconChevronRight size={16} color="var(--mantine-color-dimmed)" />
            )}
            {container && selectContainers && (
              <ActionIcon
                size="sm"
                variant="subtle"
                aria-label={`Browse into ${item.title}`}
                data-testid={`browse-into-${item.id}`}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); drill(item); }}
              >
                <IconChevronRight size={16} />
              </ActionIcon>
            )}
          </Group>
        </Group>
      </Combobox.Option>
    );
  };

  // renderValue replaces the closed-state input display entirely: the caller's
  // rich card is the whole UI while DISPLAY; editing modes mount the TextInput.
  if (renderValue && mode === Modes.DISPLAY) {
    return renderValue({ onStartEdit: startEditing, value, resolvedTitle });
  }

  const displayValue = search !== null ? search : (value || '');
  const showFreeform = !!search && search !== value && !isBrowse && search.length >= 2;

  return (
    <Combobox store={combobox} onOptionSubmit={handleOptionSubmit}>
      <Combobox.Target withKeyboardNavigation={false}>
        <TextInput
          ref={inputRef}
          value={displayValue}
          onChange={(e) => {
            handleInput(e.target.value);
            combobox.openDropdown();
          }}
          onClick={() => {
            if (modeRef.current === Modes.DISPLAY) startEditing();
            else combobox.openDropdown();
          }}
          onFocus={() => startEditing()}
          onBlur={() => {
            // Closing the dropdown routes through onDropdownClose → commit('outside')
            // (revert of typed-but-unpicked text). Escape/Tab are handled before
            // blur; this also covers programmatic focus loss.
            combobox.closeDropdown();
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          autoFocus={!!renderValue}
          leftSection={<IconSearch size={16} />}
          rightSection={(isSearching || browseLoading) ? <Loader size="xs" /> : (value ? (
            <ActionIcon
              size="sm"
              variant="subtle"
              aria-label="Clear selection"
              data-testid="combobox-clear"
              // preventDefault: a mousedown here must not blur the input while
              // editing — that closes the dropdown and commit-on-close fires
              // BEFORE this button's click, double-committing in-progress text.
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                log.info('clear.click', { prevValue: value });
                onChange(''); // hook logs value.cleared on the prop transition
              }}
            >
              <IconX size={14} />
            </ActionIcon>
          ) : null)}
        />
      </Combobox.Target>
      {search === null && !renderValue && resolvedTitle && (
        <Text size="xs" c="dimmed" mt={2} truncate data-testid="combobox-resolved-title">{resolvedTitle}</Text>
      )}

      {/* className flows to the PORTALED dropdown element. Mantine v7 <Text>
          inherits color, and the portal renders at document.body — outside the
          admin `.admin` color scope — so uncolored header/crumb Text would
          inherit the body default (dark) and read dark-on-dark. Pin a bright
          base color here; dimmed/white-on-highlight states still override. */}
      <Combobox.Dropdown className="content-combobox-dropdown">
        {/* Orientation header (BROWSE mode): the committed value isn't among the
            rendered siblings, so nothing is highlighted — surface it here. */}
        {isBrowse && value && !items.some((it) => normalizeValue(it.id) === normalizedValue) && (
          <Box p="xs" data-testid="combobox-current-anchor" style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
            <Group gap="xs" wrap="nowrap">
              <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>Current:</Text>
              <Text size="xs" fw={600} truncate>{resolvedTitle || value}</Text>
              <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>— not in this list</Text>
            </Group>
          </Box>
        )}

        {/* Breadcrumb navigation (BROWSE mode) */}
        {isBrowse && breadcrumbs.length > 0 && (
          <Box p="xs" style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
            <Group gap="xs">
              <ActionIcon
                size="sm"
                variant="subtle"
                aria-label="Back"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => { e.stopPropagation(); goUp(); }}
              >
                <IconArrowLeft size={14} />
              </ActionIcon>
              {/* Clickable trail: every non-last crumb jumps to that level via
                  goToCrumb; the last crumb is the current level (emphasized, not
                  a button). Same blur-guard as the back/clear buttons — a
                  mousedown must not blur the input and close the dropdown before
                  the click fires. */}
              <Group gap={2} wrap="nowrap" style={{ minWidth: 0, overflow: 'hidden' }}>
                {breadcrumbs.map((b, idx) => {
                  const isLast = idx === breadcrumbs.length - 1;
                  return (
                    <Group key={b.id ?? idx} gap={2} wrap="nowrap" style={{ minWidth: 0 }}>
                      {idx > 0 && (
                        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>›</Text>
                      )}
                      {isLast ? (
                        <Text size="xs" fw={600} truncate data-testid={`combobox-crumb-${idx}`}>
                          {b.title}
                        </Text>
                      ) : (
                        <Text
                          component="button"
                          type="button"
                          size="xs"
                          c="dimmed"
                          truncate
                          data-testid={`combobox-crumb-${idx}`}
                          aria-label={`Go to ${b.title}`}
                          className="combobox-crumb-button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => { e.stopPropagation(); goToCrumb(idx); }}
                        >
                          {b.title}
                        </Text>
                      )}
                    </Group>
                  );
                })}
              </Group>
            </Group>
          </Box>
        )}

        {/* Source-scope chip (SEARCH mode): a `source:term` query filters the
            search to one source — surface it, and let the user undo it (F14). */}
        {activeScope && !isBrowse && (
          <Box p="xs" data-testid="combobox-scope-chip" style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
            <Badge
              size="sm" variant="light"
              rightSection={
                <ActionIcon size="xs" variant="transparent" aria-label="Clear source scope"
                  data-testid="combobox-scope-clear"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => { e.stopPropagation(); clearScope(); }}>
                  <IconX size={12} />
                </ActionIcon>
              }>
              Searching within {activeScope}
            </Badge>
          </Box>
        )}

        {/* Pending sources indicator */}
        {pendingSources.length > 0 && !isBrowse && (
          <Box p="xs" className="pending-sources" data-pending-sources style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="xs" c="dimmed">Searching:</Text>
              {pendingSources.map((source) => (
                <Badge key={source} size="xs" variant="light" color="gray">
                  {SOURCE_ICONS[source] || SOURCE_ICONS.default} {source}
                </Badge>
              ))}
            </Group>
          </Box>
        )}

        {/* Per-source error indicator: which sources failed this search */}
        {sourceErrors?.length > 0 && !isBrowse && (
          <Box p="xs" className="source-errors" data-testid="combobox-source-errors" style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
            <Group gap="xs">
              <Text size="xs" c="red">Unavailable:</Text>
              {sourceErrors.map(({ source }) => (
                <Badge key={source} size="xs" variant="light" color="red">
                  {SOURCE_ICONS[source] || SOURCE_ICONS.default} {source}
                </Badge>
              ))}
            </Group>
          </Box>
        )}

        <Combobox.Options>
          <ScrollArea.Autosize
            mah={300}
            viewportRef={viewportRef}
            viewportProps={{ style: { overflowAnchor: 'none' } }}
            onScrollPositionChange={handleScrollPosition}
          >
            {loadingMore && pagination?.hasBefore && (
              <Group justify="center" py={4}>
                <Loader size="xs" />
              </Group>
            )}
            {(isSearching || browseLoading) && items.length === 0 ? (
              <Combobox.Empty>
                <Group justify="center" p="md" data-testid="combobox-loading">
                  <Loader size="sm" />
                  <Text size="sm" c="dimmed">{browseLoading ? 'Loading...' : 'Searching...'}</Text>
                </Group>
              </Combobox.Empty>
            ) : items.length === 0 ? (
              <Combobox.Empty>
                {isBrowse
                  ? 'No items in this container'
                  : (!search || search.length < 2)
                    ? 'Type to search...'
                    : 'No results — select “Use as raw value” or press Enter'}
              </Combobox.Empty>
            ) : (
              items.map(renderOption)
            )}
            {showFreeform && (
              <Combobox.Option value="__freeform__" key="__freeform__" data-testid="freeform-commit-option">
                <Group gap="xs"><IconPencil size={14} /><Text size="sm">Use “{search}” as raw value</Text></Group>
              </Combobox.Option>
            )}
            {loadingMore && pagination?.hasAfter && (
              <Group justify="center" py={4}>
                <Loader size="xs" />
              </Group>
            )}
            {!isBrowse && !isSearching && truncatedAt && items.length >= truncatedAt && (
              <Group justify="center" py={6} data-testid="results-truncated">
                <Text size="xs" c="dimmed">Showing first {truncatedAt} — refine your search</Text>
              </Group>
            )}
          </ScrollArea.Autosize>
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}

export default ContentCombobox;
