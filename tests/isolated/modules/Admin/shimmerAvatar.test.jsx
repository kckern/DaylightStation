// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MantineProvider } from '@mantine/core';
import { ShimmerAvatar } from '#frontend/modules/Admin/ContentLists/ListsItemRow.jsx';

// Intercept Image preloading so we can control load timing.
class FakeImage {
  constructor() { this.src = ''; this.onload = null; this.onerror = null; FakeImage.instances.push(this); }
}
FakeImage.instances = [];

const renderWithMantine = (ui) => render(<MantineProvider>{ui}</MantineProvider>);
const rerenderWithMantine = (rerender, ui) => rerender(<MantineProvider>{ui}</MantineProvider>);

beforeEach(() => {
  FakeImage.instances = [];
  vi.stubGlobal('Image', FakeImage);
});

describe('ShimmerAvatar', () => {
  it('shows shimmer placeholder while loading', () => {
    const { container } = renderWithMantine(<ShimmerAvatar src="/img/test.jpg" size={40} />);
    expect(container.querySelector('.avatar-shimmer')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('swaps to Avatar when image loads', async () => {
    const onLoadEvent = vi.fn();
    const { container } = renderWithMantine(<ShimmerAvatar src="/img/test.jpg" onLoadEvent={onLoadEvent} />);
    const fake = FakeImage.instances[0];
    fake.onload();
    await waitFor(() => expect(container.querySelector('.avatar-shimmer')).toBeNull());
    expect(onLoadEvent).toHaveBeenCalledWith(expect.objectContaining({ ok: true, src: '/img/test.jpg' }));
  });

  it('falls back to Avatar fallback on error', async () => {
    const onLoadEvent = vi.fn();
    const { container } = renderWithMantine(
      <ShimmerAvatar src="/img/missing.jpg" onLoadEvent={onLoadEvent}>A</ShimmerAvatar>
    );
    const fake = FakeImage.instances[0];
    fake.onerror();
    await waitFor(() => expect(container.querySelector('.avatar-shimmer')).toBeNull());
    expect(onLoadEvent).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it('resets to shimmer when src changes', async () => {
    const { container, rerender } = renderWithMantine(<ShimmerAvatar src="/img/a.jpg" />);
    FakeImage.instances[0].onload();
    await waitFor(() => expect(container.querySelector('.avatar-shimmer')).toBeNull());

    rerenderWithMantine(rerender, <ShimmerAvatar src="/img/b.jpg" />);
    expect(container.querySelector('.avatar-shimmer')).not.toBeNull();
  });
});
