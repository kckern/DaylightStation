// Additive caller verbs on a result row's ⋯ menu reach the caller through
// the same onAction({ kind, item }) contract; callers that pass none see no change.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ResultRow } from './ResultRow.jsx';

const item = { id: 'plex:1', title: 'Arrival', type: 'movie' };

describe('ResultRow extraActions', () => {
  it('renders caller verbs and delivers them through onAction', async () => {
    const onAction = vi.fn();
    render(<MantineProvider><ResultRow item={item} onTap={() => {}} onAction={onAction}
      extraActions={() => [{ kind: 'favourite', label: 'Add to favourites' }]} /></MantineProvider>);
    fireEvent.click(screen.getByTestId('result-more-plex:1'));
    fireEvent.click(await screen.findByTestId('result-action-favourite-plex:1'));
    expect(onAction).toHaveBeenCalledWith({ kind: 'favourite', item });
  });

  it('renders nothing extra without extraActions', async () => {
    render(<MantineProvider><ResultRow item={item} onTap={() => {}} onAction={() => {}} /></MantineProvider>);
    fireEvent.click(screen.getByTestId('result-more-plex:1'));
    await screen.findByTestId('result-action-detail-plex:1');
    expect(screen.queryByTestId('result-action-favourite-plex:1')).toBeNull();
  });
});
