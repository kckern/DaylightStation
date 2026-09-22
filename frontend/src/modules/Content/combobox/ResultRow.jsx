// frontend/src/modules/Content/combobox/ResultRow.jsx
// ONE tap grammar for a content result row, shared by the mobile full-screen
// SearchMode list (Media/search/SearchMode.jsx) and the desktop
// ContentCombobox dropdown (ContentCombobox.jsx, same directory) — both
// render the same catalog search results and both used to let tap behavior
// depend on hidden state (aimed cast target, peek view). Task 14 (spec D6)
// fixes that with one rule, enforced here in ONE place:
//
//   Playable leaf   -> tap dispatches PLAY NOW to the current destination.
//                      Trailing ⋯ opens the four queue verbs (Play Now /
//                      Play Next / Play First / Add to Queue) + Open detail.
//   Container       -> tap ALWAYS browses into it — never an accidental
//                      queue blowaway, regardless of an aimed cast target.
//                      Trailing ▶ is the explicit "send the whole thing"
//                      action (play-as-queue to the current destination).
//
// This file lives under Content/, not Media/, because ContentCombobox
// (Content/combobox/) needs it too and Content/ may never import from
// Media/ (layering rule; see Task 10's fix round, which relocated
// StreamStatusLine here for the identical reason). ResultRow itself knows
// nothing about casting, queues, or navigation — callers own ALL of that via
// the onTap/onPlayAll/onMore callback props. `onMore` is called with a verb
// string ('playNow'|'playNext'|'upNext'|'add'|'detail'); the legacy `upNext`
// slot is presented and dispatched as Task 3's `playFirst` action when the
// additive onAction contract is used. The caller maps legacy onMore values
// that onto its own dispatch/queue/nav plumbing (see
// Media/search/resultRowVerbs.js).
import React from 'react';
import { ActionIcon, Menu } from '@mantine/core';
import { IconPlayerPlay, IconDotsVertical } from '@tabler/icons-react';
import { isContainer } from './comboboxMachine.js';

/**
 * Trailing action control for a result row: a container gets a single ▶
 * (play-as-queue) button; a leaf gets a ⋯ menu with the four queue verbs +
 * Open detail. Renders nothing if the relevant callback isn't provided —
 * this is what lets ContentCombobox's non-media callers (admin content-id
 * pickers) opt OUT simply by not passing onPlayAll/onMore, with zero visual
 * or behavioral change.
 */
export function ResultRowActions({
  item, isContainerItem, onPlayAll, onMore, onAction, testId,
  onMoreMenuPointerDown, onMoreMenuChange, onMoreMenuAction, onMoreMenuTriggerFocus, onMoreBoundaryBlur,
}) {
  const container = isContainerItem ?? (item ? isContainer(item) : false);
  const idPart = testId ?? item?.id ?? 'row';
  const moreTriggerRef = React.useRef(null);

  if (container && !onAction) {
    if (!onPlayAll) return null;
    return (
      <ActionIcon
        size="sm"
        variant="subtle"
        aria-label="Play as queue"
        data-testid={`result-play-all-${idPart}`}
        // Rows this sits inside (Combobox.Option, or a tap <button>) treat
        // any click as a select/tap. Keep the combobox input focused through
        // pointerdown too: its blur closes the portaled result list before a
        // trailing action's click can run.
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPlayAll(); }}
      >
        <IconPlayerPlay size={16} />
      </ActionIcon>
    );
  }

  if (!onMore && !onAction) return null;
  const fire = (action) => (e) => {
    e?.stopPropagation?.();
    // Set before onMore mutates a session and Menu dismisses its portal. The
    // parent uses it to distinguish this intentional action dismissal from an
    // actual move to an external focus target.
    onMoreMenuAction?.(e?.detail === 0 ? 'keyboard' : 'pointer');
    if (onAction) onAction({ kind: ({ upNext: 'playFirst', detail: 'details' })[action] ?? action, item });
    else onMore(action);
  };
  const isMoreBoundary = (element) => element?.closest?.('[data-content-combobox-more-boundary]');
  const retainMenuPointerFocus = (e, isPortaledMenu) => {
    // Mantine's outer dropdown observes native pointerdown before the React
    // mouse phase. The nested Menu portal must mark that event handled there,
    // or the outer click-outside handler closes and commits the combobox.
    e.preventDefault();
    onMoreMenuPointerDown?.(moreTriggerRef.current, isPortaledMenu);
  };
  return (
    <>
    {container && onAction && onPlayAll && <ActionIcon size="sm" variant="subtle" aria-label="Play as queue" data-testid={`result-play-all-${idPart}`}
      onMouseDown={event => event.preventDefault()} onClick={event => { event.preventDefault(); event.stopPropagation(); onPlayAll(); }}><IconPlayerPlay size={16} /></ActionIcon>}
    <Menu withinPortal position="bottom-end" shadow="sm" onChange={onMoreMenuChange}>
      <Menu.Target>
        <ActionIcon
          ref={moreTriggerRef}
          size="sm"
          variant="subtle"
          aria-label="More actions"
          data-testid={`result-more-${idPart}`}
          data-content-combobox-more-trigger
          data-content-combobox-more-boundary
          // `click` is too late to protect a combobox: the browser blurs its
          // input on pointerdown, which closes the result portal before this
          // Menu can open. Retaining input focus also lets the menu's portal
          // coexist with the result list until an explicit verb is chosen.
          onPointerDown={(e) => retainMenuPointerFocus(e, false)}
          onMouseDown={(e) => { e.preventDefault(); onMoreMenuPointerDown?.(e.currentTarget); }}
          onFocus={onMoreMenuTriggerFocus}
          onBlur={(e) => {
            if (!isMoreBoundary(e.relatedTarget)) onMoreBoundaryBlur?.(e.relatedTarget);
          }}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <IconDotsVertical size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown
        // Menu items render in a second portal. Their pointerdown must retain
        // the combobox's focus for the same reason as the trigger above;
        // keyboard focus remains under Mantine's normal menu management.
        onPointerDown={(e) => retainMenuPointerFocus(e, true)}
        onMouseDown={(e) => e.preventDefault()}
        onBlur={(e) => {
          if (!isMoreBoundary(e.relatedTarget)) onMoreBoundaryBlur?.(e.relatedTarget);
        }}
        onClick={(e) => e.stopPropagation()}
        data-content-combobox-more-boundary
        data-testid={`result-more-menu-${idPart}`}
      >
        <Menu.Item data-testid={`result-action-playNow-${idPart}`} onClick={fire('playNow')}>Play Now</Menu.Item>
        {container && onAction && <Menu.Item onClick={fire('shuffle')}>Shuffle</Menu.Item>}
        <Menu.Item data-testid={`result-action-playNext-${idPart}`} onClick={fire('playNext')}>Play Next</Menu.Item>
        <Menu.Item data-testid={`result-action-upNext-${idPart}`} onClick={fire('upNext')}>{onAction ? 'Play First' : 'Up Next'}</Menu.Item>
        <Menu.Item data-testid={`result-action-add-${idPart}`} onClick={fire('add')}>Add to Queue</Menu.Item>
        {onAction && <Menu.Item onClick={fire('playOn')}>Play on…</Menu.Item>}
        {onAction && <Menu.Item onClick={fire('addOn')}>Add on…</Menu.Item>}
        <Menu.Divider />
        <Menu.Item data-testid={`result-action-detail-${idPart}`} onClick={fire('detail')}>Open detail</Menu.Item>
      </Menu.Dropdown>
    </Menu>
    </>
  );
}

/**
 * Full result row: thumbnail + title/subtitle (tap target) + trailing
 * ResultRowActions. Presentation-only — title/subtitle/thumbnail are
 * pre-computed by the caller (SearchMode uses Media's resultPresentation.js;
 * that formatting logic is Media-specific and must not be imported here).
 *
 * @param {object} props
 * @param {object} props.item - the result row data (used only to derive
 *   isContainer and as the id namespace for testids/aria — never read for
 *   display text, which the caller already computed).
 * @param {string} [props.title]
 * @param {string} [props.subtitle]
 * @param {string} [props.thumbnail]
 * @param {() => void} props.onTap
 * @param {() => void} [props.onPlayAll] - container-only: the ▶ verb
 * @param {(action: string) => void} [props.onMore] - leaf-only: the ⋯ verb
 * @param {string} [props.testId] - testid for the tap button (defaults to `result-row-${item.id}`)
 */
export function ResultRow({ item, title, subtitle, thumbnail, onTap, onPlayAll, onMore, onAction, testId }) {
  const container = item ? isContainer(item) : false;
  const idPart = item?.id ?? 'row';
  const rowTestId = testId ?? `result-row-${idPart}`;
  const displayTitle = title ?? item?.title ?? idPart;

  return (
    <>
      <button
        type="button"
        className="result-row-main"
        data-testid={rowTestId}
        onClick={onTap}
      >
        {thumbnail && <img className="media-result-thumb" src={thumbnail} alt="" />}
        <span className="media-result-text">
          <span className="media-result-title">{displayTitle}</span>
          {subtitle && <span className="media-result-subtitle">{subtitle}</span>}
        </span>
      </button>
      {/* .media-result-actions: existing MediaShell.scss trailing-strip class
          (flex, gap 4px, flex-shrink 0) — reused here rather than inventing a
          new one, mirroring .browse-row-actions' role in BrowseView.jsx. */}
      <span className="media-result-actions">
        <ResultRowActions item={item} isContainerItem={container} onPlayAll={onPlayAll} onMore={onMore} onAction={onAction} testId={idPart} />
      </span>
    </>
  );
}

export default ResultRow;
