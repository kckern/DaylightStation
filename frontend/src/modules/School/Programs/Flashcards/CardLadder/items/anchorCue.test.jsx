import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TypedItem from './TypedItem.jsx';
import ChoiceItem from './ChoiceItem.jsx';
import SayItem from './SayItem.jsx';
import TilesItem from './TilesItem.jsx';
import DrillItem from './DrillItem.jsx';
import { playClip } from '../cardLadderAudio.js';

// Ruling 2026-09-23 (owner): anchor-side cues show text + picture + audio
// together; the prompt is never the test. The server sends one bundle.
vi.mock('../cardLadderAudio.js', () => ({ playClip: vi.fn(async () => true), playSequence: vi.fn(async () => {}) }));
vi.mock('../useTakeRecorder.js', () => ({
  default: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), phase: 'idle', verdict: null, stream: null, onLevel: vi.fn(), unavailable: false })),
}));
vi.mock('../../../../../../hooks/useHardwareKeyboard.js', () => ({ useHardwareKeyboard: () => false, default: () => false }));

const langs = { target: 'ko', anchor: 'en', targetScript: 'hangul' };
const id = (x) => x;
const bundle = { type: 'anchor', text: 'Scissors', image: true, audio: true };
const assets = { image: 'img-gawi', audio: null, glossAudio: 'gloss-gawi' };

const renders = {
  'typed 3.3': (cue = bundle) => <TypedItem item={{ id: 't1', type: 'typed', task: '3.3', cue, assets }} mode="graded" langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />,
  'choice 3.1': (cue = bundle) => <ChoiceItem item={{ id: 'c1', type: 'choice', task: '3.1', cue, choices: ['가위', '풀'], assets }} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />,
  'say-from-cue': (cue = bundle) => <SayItem item={{ id: 's1', type: 'say', mode: 'say-from-cue', cue, assets }} mode="say-from-cue" langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} api={{ uploadRecording: vi.fn() }} sittingId="s" userId="kid" />,
  'drill tiles': (cue = bundle) => <TilesItem item={{ id: 'd1', type: 'drill', step: 'tiles', tiles: ['가', '위'], cue, assets }} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />,
  'drill type': (cue = bundle) => <DrillItem item={{ id: 'd2', type: 'drill', step: 'type', cue, assets, of: 9, at: 9 }} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />,
};

afterEach(() => playClip.mockClear());

describe.each(Object.entries(renders))('%s: the anchor cue bundle', (_, ui) => {
  it('shows the picture, the English text and a Listen (Tab) together', () => {
    const { container } = render(ui());
    expect(screen.getByText('Scissors')).toBeInTheDocument();
    expect(container.querySelector('img.wl-cue-picture')).toHaveAttribute('src', 'img-gawi');
    const listen = screen.getByRole('button', { name: /listen/i });
    expect(listen.querySelector('.ds-touch__key')).toHaveTextContent('Tab');
    fireEvent.click(listen);
    expect(playClip).toHaveBeenCalledWith('gloss-gawi', 'gloss');
  });

  it('Tab plays the gloss clip', () => {
    render(ui());
    playClip.mockClear();
    fireEvent.keyDown(document.activeElement ?? window, { key: 'Tab', code: 'Tab' });
    expect(playClip).toHaveBeenCalledWith('gloss-gawi', 'gloss');
  });

  it('never an audio-only prompt: with no picture the text still shows beside Listen', () => {
    const { container } = render(ui({ type: 'anchor', text: 'Scissors', image: false, audio: true }));
    expect(screen.getByText('Scissors')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /listen/i })).toBeInTheDocument();
    expect(container.querySelector('img.wl-cue-picture')).toBeNull();
  });

  it('text alone when there is neither picture nor audio', () => {
    render(ui({ type: 'anchor', text: 'Scissors', image: false, audio: false }));
    expect(screen.getByText('Scissors')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /listen/i })).toBeNull();
  });
});
