// frontend/src/modules/Content/combobox/ResultRow.test.jsx
// The ONE tap grammar (Task 14, spec D6): leaves play on tap + expose a ⋯
// verb menu; containers browse on tap + expose a single ▶ (play-as-queue)
// action. Presentation-only component — callbacks are the whole contract.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ResultRow, ResultRowActions } from './ResultRow.jsx';

function renderWithProvider(ui) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

const leafItem = { id: 'plex:1', title: 'Bluey', type: 'episode' };
const containerItem = { id: 'plex:663508', title: 'Tuttle Twins', type: 'show' };

describe('ResultRow — leaf', () => {
  it('tapping the row calls onTap', () => {
    const onTap = vi.fn();
    renderWithProvider(<ResultRow item={leafItem} title="Bluey" onTap={onTap} />);
    fireEvent.click(screen.getByTestId('result-row-plex:1'));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('renders no ▶ (play-as-queue is container-only)', () => {
    const onPlayAll = vi.fn();
    renderWithProvider(<ResultRow item={leafItem} title="Bluey" onTap={() => {}} onPlayAll={onPlayAll} />);
    expect(screen.queryByTestId('result-play-all-plex:1')).toBeNull();
  });

  it('renders no ⋯ trigger when onMore is not provided', () => {
    renderWithProvider(<ResultRow item={leafItem} title="Bluey" onTap={() => {}} />);
    expect(screen.queryByTestId('result-more-plex:1')).toBeNull();
  });

  it('⋯ opens a menu with the four queue verbs + Open detail', async () => {
    renderWithProvider(<ResultRow item={leafItem} title="Bluey" onTap={() => {}} onMore={() => {}} />);
    fireEvent.click(screen.getByTestId('result-more-plex:1'));
    expect(await screen.findByTestId('result-action-playNow-plex:1')).toBeInTheDocument();
    expect(screen.getByTestId('result-action-playNext-plex:1')).toBeInTheDocument();
    expect(screen.getByTestId('result-action-upNext-plex:1')).toBeInTheDocument();
    expect(screen.getByTestId('result-action-add-plex:1')).toBeInTheDocument();
    expect(screen.getByTestId('result-action-detail-plex:1')).toBeInTheDocument();
  });

  it.each([
    ['result-action-playNow-plex:1', 'playNow'],
    ['result-action-playNext-plex:1', 'playNext'],
    ['result-action-upNext-plex:1', 'upNext'],
    ['result-action-add-plex:1', 'add'],
    ['result-action-detail-plex:1', 'detail'],
  ])('%s calls onMore(%j)', async (testId, verb) => {
    const onMore = vi.fn();
    renderWithProvider(<ResultRow item={leafItem} title="Bluey" onTap={() => {}} onMore={onMore} />);
    fireEvent.click(screen.getByTestId('result-more-plex:1'));
    fireEvent.click(await screen.findByTestId(testId));
    expect(onMore).toHaveBeenCalledWith(verb);
  });

  it('opening the ⋯ menu does not also fire onTap', () => {
    const onTap = vi.fn();
    renderWithProvider(<ResultRow item={leafItem} title="Bluey" onTap={onTap} onMore={() => {}} />);
    fireEvent.click(screen.getByTestId('result-more-plex:1'));
    expect(onTap).not.toHaveBeenCalled();
  });

  it('picking a verb does not also fire onTap', async () => {
    const onTap = vi.fn();
    const onMore = vi.fn();
    renderWithProvider(<ResultRow item={leafItem} title="Bluey" onTap={onTap} onMore={onMore} />);
    fireEvent.click(screen.getByTestId('result-more-plex:1'));
    fireEvent.click(await screen.findByTestId('result-action-playNow-plex:1'));
    expect(onTap).not.toHaveBeenCalled();
  });
});

describe('ResultRow — container', () => {
  it('tapping the row calls onTap (browse), not onPlayAll', () => {
    const onTap = vi.fn();
    const onPlayAll = vi.fn();
    renderWithProvider(<ResultRow item={containerItem} title="Tuttle Twins" onTap={onTap} onPlayAll={onPlayAll} />);
    fireEvent.click(screen.getByTestId('result-row-plex:663508'));
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onPlayAll).not.toHaveBeenCalled();
  });

  it('renders no ⋯ (the four-verb menu is leaf-only)', () => {
    renderWithProvider(<ResultRow item={containerItem} title="Tuttle Twins" onTap={() => {}} onMore={() => {}} />);
    expect(screen.queryByTestId('result-more-plex:663508')).toBeNull();
  });

  it('renders no ▶ when onPlayAll is not provided', () => {
    renderWithProvider(<ResultRow item={containerItem} title="Tuttle Twins" onTap={() => {}} />);
    expect(screen.queryByTestId('result-play-all-plex:663508')).toBeNull();
  });

  it('▶ calls onPlayAll and not onTap', () => {
    const onTap = vi.fn();
    const onPlayAll = vi.fn();
    renderWithProvider(<ResultRow item={containerItem} title="Tuttle Twins" onTap={onTap} onPlayAll={onPlayAll} />);
    fireEvent.click(screen.getByTestId('result-play-all-plex:663508'));
    expect(onPlayAll).toHaveBeenCalledTimes(1);
    expect(onTap).not.toHaveBeenCalled();
  });
});

describe('ResultRowActions — used standalone (desktop ContentCombobox reuse)', () => {
  it('renders nothing for a leaf with no onMore and no container with no onPlayAll', () => {
    renderWithProvider(<ResultRowActions item={leafItem} isContainerItem={false} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('respects an explicit isContainerItem override independent of the item shape', () => {
    const onPlayAll = vi.fn();
    renderWithProvider(
      <ResultRowActions item={leafItem} isContainerItem testId="x" onPlayAll={onPlayAll} />
    );
    expect(screen.getByTestId('result-play-all-x')).toBeInTheDocument();
  });
});
