import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { PlaybackQualityProvider, PlaybackQualityHost, usePlaybackQuality } from './PlaybackQualityProvider.jsx';
import { ItemQualityButton, ActiveQualityButton } from './PlaybackQualityButtons.jsx';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { createLocalSessionController } from '../session/LocalSessionController.js';
import { DismissStackProvider } from '../shell/DismissStackProvider.jsx';

const item = { id: 'plex:42', contentId: 'plex:42', title: 'Movie', type: 'movie', format: 'video' };
function Selected() {
  const quality = usePlaybackQuality();
  return <><ItemQualityButton item={item} /><output data-testid="saved-quality">{JSON.stringify(quality.getOverrides('plex:42'))}</output>
    <output data-testid="other-quality">{JSON.stringify(quality.getOverrides('plex:43'))}</output></>;
}
function wrap(children, controller = null) {
  return render(<MantineProvider><PlaybackQualityProvider><DismissStackProvider>
    <LocalSessionContext.Provider value={{ controller }}>{children}<PlaybackQualityHost /></LocalSessionContext.Provider>
  </DismissStackProvider></PlaybackQualityProvider></MantineProvider>);
}
async function resolution(value = '720p') {
  fireEvent.change(screen.getByLabelText('Maximum resolution'), { target: { value: value.replace('p', '') } });
}
beforeEach(() => sessionStorage.clear());
afterEach(cleanup);

describe('MediaApp item quality overrides', () => {
  it('sets explicit quality on one selected item without starting playback', async () => {
    wrap(<Selected />);
    fireEvent.click(screen.getByRole('button', { name: /quality/i }));
    await resolution();
    fireEvent.change(screen.getByLabelText('Maximum bitrate (kbps)'), { target: { value: '4000' } });
    fireEvent.change(screen.getByLabelText('Conversion'), { target: { value: 'force' } });
    fireEvent.click(screen.getByRole('switch', { name: /Automatic quality/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save overrides' }));
    await waitFor(() => expect(screen.getByTestId('saved-quality')).toHaveTextContent('"maxResolution":"720"'));
    expect(JSON.parse(screen.getByTestId('saved-quality').textContent)).toEqual({ maxResolution: '720', maxVideoBitrate: 4000, transcode: 'force', adaptive: false });
    expect(screen.getByTestId('other-quality')).toHaveTextContent('{}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /quality/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Use defaults' }));
    await waitFor(() => expect(screen.getByTestId('saved-quality')).toHaveTextContent('{}'));
  });

  it('applies quality to paused local playback at its hot position', async () => {
    const controller = createLocalSessionController({ clientId: 'here' });
    await controller.queue.playNow(item);
    controller.onPlayerPositionTick(4320.75);
    controller.onPlayerStateChange('paused', item.contentId);
    wrap(<ActiveQualityButton target="local" />, controller);
    fireEvent.click(screen.getByRole('button', { name: /quality/i }));
    await resolution();
    fireEvent.click(screen.getByRole('button', { name: 'Apply to current playback' }));
    await waitFor(() => expect(controller.getSnapshot().currentItem.maxResolution).toBe('720'));
    expect(controller.getSnapshot()).toMatchObject({ state: 'paused', position: 4320.75 });
  });

  it('refuses to apply an open panel to a different playing item', async () => {
    const controller = createLocalSessionController({ clientId: 'here' });
    await controller.queue.playNow(item);
    wrap(<ActiveQualityButton target="local" />, controller);
    fireEvent.click(screen.getByRole('button', { name: /quality/i }));
    await resolution();
    await act(async () => controller.queue.playNow({ ...item, contentId: 'plex:43' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply to current playback' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/playing item changed/i);
    expect(controller.getSnapshot().currentItem).not.toHaveProperty('maxResolution');
  });

  it('does not offer video conversion on audio or unrelated providers', () => {
    wrap(<><ItemQualityButton item={{ contentId: 'plex:9', format: 'audio' }} /><ItemQualityButton item={{ contentId: 'libby:9', format: 'video' }} /></>);
    expect(screen.queryByRole('button', { name: /quality/i })).not.toBeInTheDocument();
  });

  it.each([undefined, { status: 'accepted' }])('keeps the sheet open without a positive owner acknowledgement: %j', async reply => {
    const controller = createLocalSessionController({ clientId: 'here' });
    await controller.queue.playNow(item);
    controller.quality.setOverrides = async () => reply;
    wrap(<ActiveQualityButton target="local" />, controller);
    fireEvent.click(screen.getByRole('button', { name: /quality/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply to current playback' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not confirm/i);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

});
