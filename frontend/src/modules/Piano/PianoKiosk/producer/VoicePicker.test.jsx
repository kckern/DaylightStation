/**
 * VoicePicker tests — the 8 tier-2 voices always offered (SSOT: presetManifest
 * GM_PROGRAMS), the full GM 128 only behind the onboardGm flag (collapsed
 * family sections), select-fires-and-closes, current-voice marking.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  VoicePicker, voiceName, BASE_VOICES, FRIENDLY_VOICE_NAMES, GM_FAMILY_SECTIONS,
} from './VoicePicker.jsx';
import { GM_PROGRAMS } from './presetManifest.js';

const FRIENDLY = [
  'Grand Piano', 'E-Piano', 'Nylon Guitar', 'Steel Guitar',
  'Acoustic Bass', 'Fingered Bass', 'Strings', 'Synth Pad',
];

function renderPicker(props = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(<VoicePicker current={0} onSelect={onSelect} onClose={onClose} {...props} />);
  return { onSelect, onClose };
}

describe('voice catalog data', () => {
  it('BASE_VOICES mirror presetManifest GM_PROGRAMS 1:1, each with a friendly name', () => {
    expect(BASE_VOICES.map((v) => v.program)).toEqual(GM_PROGRAMS);
    for (const p of GM_PROGRAMS) expect(FRIENDLY_VOICE_NAMES[p]).toBeTruthy();
    expect(BASE_VOICES.map((v) => v.name)).toEqual(FRIENDLY);
  });

  it('GM_FAMILY_SECTIONS cover the full GM 128 as 16 families of 8', () => {
    expect(GM_FAMILY_SECTIONS.length).toBe(16);
    const programs = GM_FAMILY_SECTIONS.flatMap((s) => s.voices.map((v) => v.program));
    expect(programs.length).toBe(128);
    expect(new Set(programs).size).toBe(128);
    expect(Math.min(...programs)).toBe(0);
    expect(Math.max(...programs)).toBe(127);
  });

  it('voiceName: friendly tier-2 label > GM catalog name > numbered fallback; null = Drums', () => {
    expect(voiceName(0)).toBe('Grand Piano'); // friendly beats "Acoustic Grand"
    expect(voiceName(33)).toBe('Fingered Bass');
    expect(voiceName(19)).toBe('Church Organ'); // GM catalog name
    expect(voiceName(null)).toBe('Drums');
  });
});

describe('VoicePicker', () => {
  it('is a drawer dialog offering the 8 base voices, always', () => {
    renderPicker();
    expect(screen.getByRole('dialog', { name: 'voice picker' })).toBeInTheDocument();
    for (const name of FRIENDLY) {
      expect(screen.getByRole('option', { name })).toBeInTheDocument();
    }
  });

  it('without the onboardGm flag there are NO family sections (8 voices only)', () => {
    renderPicker();
    expect(screen.getAllByRole('option').length).toBe(8);
    expect(screen.queryByText('All 128 GM voices')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Organ/ })).toBeNull();
  });

  it('with onboardGm: 16 collapsed family sections; tap a family to expand its 8 voices', () => {
    renderPicker({ onboardGm: true });
    expect(screen.getByText('All 128 GM voices')).toBeInTheDocument();
    const heads = document.querySelectorAll('.piano-voice-picker__family-head');
    expect(heads.length).toBe(16);
    for (const head of heads) expect(head).toHaveAttribute('aria-expanded', 'false');
    // Collapsed: no family voices beyond the 8 base options.
    expect(screen.getAllByRole('option').length).toBe(8);
    // Expand Organ → its 8 voices appear.
    fireEvent.click(screen.getByRole('button', { name: /^Organ$/ }));
    expect(screen.getByRole('option', { name: 'Church Organ' })).toBeInTheDocument();
    expect(screen.getAllByRole('option').length).toBe(16);
    // Expanding another family collapses the first (one open at a time).
    fireEvent.click(screen.getByRole('button', { name: /^Brass$/ }));
    expect(screen.queryByRole('option', { name: 'Church Organ' })).toBeNull();
    expect(screen.getByRole('option', { name: 'French Horn' })).toBeInTheDocument();
  });

  it('marks the current voice selected (✓)', () => {
    renderPicker({ current: 33 });
    const current = screen.getByRole('option', { name: /Fingered Bass/ });
    expect(current).toHaveAttribute('aria-selected', 'true');
    expect(current.textContent).toContain('✓');
    expect(screen.getByRole('option', { name: 'Grand Piano' })).toHaveAttribute('aria-selected', 'false');
  });

  it('tapping a voice fires onSelect(program) and closes', () => {
    const { onSelect, onClose } = renderPicker();
    fireEvent.click(screen.getByRole('option', { name: 'Nylon Guitar' }));
    expect(onSelect).toHaveBeenCalledWith(24);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('selecting from an expanded family fires the exact GM program number', () => {
    const { onSelect } = renderPicker({ onboardGm: true });
    fireEvent.click(screen.getByRole('button', { name: /^Organ$/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Church Organ' }));
    expect(onSelect).toHaveBeenCalledWith(19);
  });

  it('close button and scrim both dismiss without selecting', () => {
    const { onSelect, onClose } = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'close voice picker' }));
    fireEvent.click(screen.getByRole('button', { name: 'dismiss voice picker' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
