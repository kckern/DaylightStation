/**
 * ChannelStrip tests — assembly (glyph / identity / voice chip / M/S / gain /
 * remove), handler wiring (spies), the 2-tap remove confirm, groove chip
 * disabled, and the shared-drum-channel honesty hint.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ChannelStrip } from './ChannelStrip.jsx';

const chordLayer = {
  id: 'chord-progressions/niko/dm.mid',
  source: {
    kind: 'library',
    entry: {
      path: 'chord-progressions/niko/dm.mid',
      slug: 'dm-c-f-gm',
      title: 'Dm C · F Gm',
      type: 'chord-progression',
      roman: ['i', 'bVII', 'bIII', 'iv'],
    },
  },
  role: 'chords',
  channel: 0,
  gmProgram: 0,
  gain: 1,
  muted: false,
  soloed: false,
  carried: false,
};

const grooveLayer = {
  id: 'grooves/basic-rock.mid',
  source: {
    kind: 'library',
    entry: { path: 'grooves/basic-rock.mid', slug: 'basic-rock', title: 'Basic Rock', type: 'groove', feel: 'rock' },
  },
  role: 'groove',
  channel: 9,
  gmProgram: null,
  gain: 1,
  muted: false,
  soloed: false,
  carried: false,
};

function renderStrip(layer = chordLayer, props = {}) {
  const handlers = {
    onToggleMute: vi.fn(),
    onToggleSolo: vi.fn(),
    onRemove: vi.fn(),
    onGain: vi.fn(),
    onVoice: vi.fn(),
  };
  const utils = render(<ChannelStrip layer={layer} {...handlers} {...props} />);
  return { ...utils, ...handlers };
}

/** Tap the gain strip at `fraction` of its width (jsdom: manual pointer events).
 *  The strip lives in a popover now — open it via the compact chip first. */
function tapGain(container, fraction) {
  fireEvent.click(container.querySelector('.piano-channel-strip__gain-chip'));
  const strip = container.querySelector('.piano-gain-strip');
  vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, width: 200, height: 48, right: 200, bottom: 48, x: 0, y: 0,
  });
  strip.setPointerCapture = vi.fn();
  for (const type of ['pointerdown', 'pointerup']) {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(ev, { pointerId: 1, clientX: fraction * 200, clientY: 24 });
    fireEvent(strip, ev);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ChannelStrip assembly', () => {
  it('renders glyph, roman identity, role tag, voice chip, M/S, gain strip and remove', () => {
    const { container } = renderStrip();
    expect(container.querySelector('.piano-material-glyph')).toBeTruthy();
    expect(container.querySelector('.roman-progression')).toBeTruthy();
    expect(screen.getByText('chords')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'voice' })).toHaveTextContent('Grand Piano');
    expect(screen.getByLabelText('mute')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('solo')).toHaveAttribute('aria-pressed', 'false');
    // Gain is a compact chip (the wide strip opens in a popover on tap).
    expect(container.querySelector('.piano-channel-strip__gain-chip')).toBeTruthy();
    expect(container.querySelector('.piano-gain-strip')).toBeNull(); // closed until tapped
    expect(screen.getByLabelText('remove layer')).toBeInTheDocument();
  });

  it('falls back to title/slug identity when the entry has no roman', () => {
    const { container } = renderStrip(grooveLayer);
    expect(container.querySelector('.roman-progression')).toBeNull();
    expect(screen.getByText('Basic Rock')).toBeInTheDocument();
    expect(screen.getByText('groove')).toBeInTheDocument();
  });

  it('reflects muted state (row class + muted gain chip showing "Muted"), M/S latch via aria-pressed', () => {
    const { container } = renderStrip({ ...chordLayer, muted: true, soloed: true });
    expect(container.querySelector('.piano-channel-strip').className).toContain('is-muted');
    const chip = container.querySelector('.piano-channel-strip__gain-chip');
    expect(chip.className).toContain('is-muted');
    expect(chip).toHaveTextContent('Muted');
    expect(screen.getByLabelText('mute')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('solo')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('ChannelStrip wiring', () => {
  it('M / S taps dispatch with the layer id', () => {
    const { onToggleMute, onToggleSolo } = renderStrip();
    fireEvent.click(screen.getByLabelText('mute'));
    expect(onToggleMute).toHaveBeenCalledWith(chordLayer.id);
    fireEvent.click(screen.getByLabelText('solo'));
    expect(onToggleSolo).toHaveBeenCalledWith(chordLayer.id);
  });

  it('a gain-strip tap dispatches onGain(id, curveGain)', () => {
    const { container, onGain } = renderStrip();
    tapGain(container, 0.5); // midpoint → level 50 → gain 0.1
    expect(onGain).toHaveBeenCalledTimes(1);
    expect(onGain.mock.calls[0][0]).toBe(chordLayer.id);
    expect(onGain.mock.calls[0][1]).toBeCloseTo(0.1, 10);
  });

  it('voice chip opens the picker; selecting dispatches onVoice(id, program) and closes', () => {
    const { onVoice } = renderStrip();
    expect(screen.queryByRole('dialog', { name: 'voice picker' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'voice' }));
    expect(screen.getByRole('dialog', { name: 'voice picker' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Nylon Guitar' }));
    expect(onVoice).toHaveBeenCalledWith(chordLayer.id, 24);
    expect(screen.queryByRole('dialog', { name: 'voice picker' })).toBeNull();
  });

  it('passes onboardGm through to the picker (full GM catalog)', () => {
    renderStrip(chordLayer, { onboardGm: true });
    fireEvent.click(screen.getByRole('button', { name: 'voice' }));
    expect(screen.getByText('All 128 GM voices')).toBeInTheDocument();
  });
});

describe('carry pin (§4.1 continuity)', () => {
  it('renders only when onToggleCarried is provided; latches via aria-pressed with the carry title', () => {
    renderStrip(); // no onToggleCarried prop
    expect(screen.queryByLabelText('carry')).toBeNull();

    renderStrip(chordLayer, { onToggleCarried: vi.fn() });
    const pin = screen.getByLabelText('carry');
    expect(pin).toHaveAttribute('aria-pressed', 'false');
    expect(pin).toHaveAttribute('title', 'Carry across sections');
  });

  it('tap dispatches onToggleCarried(id); a carried layer shows the pin latched', () => {
    const onToggleCarried = vi.fn();
    renderStrip(chordLayer, { onToggleCarried });
    fireEvent.click(screen.getByLabelText('carry'));
    expect(onToggleCarried).toHaveBeenCalledWith(chordLayer.id);

    renderStrip({ ...chordLayer, carried: true }, { onToggleCarried: vi.fn() });
    const pins = screen.getAllByLabelText('carry');
    expect(pins[pins.length - 1]).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('remove 2-tap confirm', () => {
  it('first tap arms ("Sure?") without removing; second tap removes', () => {
    const { onRemove } = renderStrip();
    const remove = screen.getByLabelText('remove layer');
    fireEvent.click(remove);
    expect(onRemove).not.toHaveBeenCalled();
    expect(remove).toHaveTextContent('Sure?');
    expect(remove.className).toContain('is-armed');
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledWith(chordLayer.id);
  });

  it('disarms itself after 3 s (accidental-tap protection)', () => {
    vi.useFakeTimers();
    const { onRemove } = renderStrip();
    const remove = screen.getByLabelText('remove layer');
    fireEvent.click(remove);
    expect(remove).toHaveTextContent('Sure?');
    act(() => { vi.advanceTimersByTime(3100); });
    expect(remove).toHaveTextContent('✕');
    // A tap AFTER the window re-arms instead of removing.
    fireEvent.click(remove);
    expect(onRemove).not.toHaveBeenCalled();
    expect(remove).toHaveTextContent('Sure?');
  });
});

describe('groove layers', () => {
  it('voice chip is disabled and labeled Drums — the picker can never open', () => {
    renderStrip(grooveLayer);
    const chip = screen.getByRole('button', { name: 'voice' });
    expect(chip).toBeDisabled();
    expect(chip).toHaveTextContent('Drums');
    fireEvent.click(chip);
    expect(screen.queryByRole('dialog', { name: 'voice picker' })).toBeNull();
  });

  it('shows the "all drums" hint only when MORE than one groove shares channel 9', () => {
    const { unmount } = renderStrip(grooveLayer, { grooveCount: 2 });
    expect(screen.getByText('all drums')).toBeInTheDocument();
    unmount();
    const { unmount: unmount2 } = renderStrip(grooveLayer, { grooveCount: 1 });
    expect(screen.queryByText('all drums')).toBeNull();
    unmount2();
    // Never on non-groove strips, whatever the groove count.
    renderStrip(chordLayer, { grooveCount: 3 });
    expect(screen.queryByText('all drums')).toBeNull();
  });
});

describe('Keep to Crate (Task 8.2)', () => {
  const takeLayer = {
    id: 'take-1',
    source: { kind: 'take', takeId: 'take-1', notes: [{ ticks: 0, durationTicks: 480, midi: 40 }], ppq: 480, lengthBars: 2, drumMode: false },
    role: 'bass', channel: 1, gmProgram: 33, gain: 1, muted: false, soloed: false, carried: false,
  };

  it('recorded (take) layers expose Keep to Crate and call the handler with the layer', () => {
    const onKeepToCrate = vi.fn();
    renderStrip(takeLayer, { onKeepToCrate });
    const keep = screen.getByRole('button', { name: 'keep to crate' });
    fireEvent.click(keep);
    expect(onKeepToCrate).toHaveBeenCalledWith(takeLayer);
    expect(screen.getByText('Kept')).toBeInTheDocument(); // latches
  });

  it('library layers never show Keep to Crate (already in the library)', () => {
    renderStrip(chordLayer, { onKeepToCrate: vi.fn() });
    expect(screen.queryByRole('button', { name: 'keep to crate' })).toBeNull();
  });

  it('no Keep button without the handler', () => {
    renderStrip(takeLayer);
    expect(screen.queryByRole('button', { name: 'keep to crate' })).toBeNull();
  });
});
