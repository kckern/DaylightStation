import { describe, it, expect, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCenterByWidest } from './useCenterByWidest.js';

// jsdom has no layout engine — every offsetWidth is 0 — so widths are stubbed.
// This pins the hook's arithmetic only; the CSS shrink-wrap that makes the
// stanza measurement meaningful is proven in a real browser by
// tests/live/flow/admin/preview-player-centering.runtime.test.mjs.
function stubWidth(el, value) {
  Object.defineProperty(el, 'offsetWidth', { value, configurable: true });
}

/**
 * Builds .textpanel > .scrolled-content > .hymn-text > .stanza and returns a ref
 * to the .hymn-text container, mirroring the real Player markup.
 */
function buildPanel({ panelWidth, paddingLeft, stanzaWidths }) {
  const panel = document.createElement('div');
  panel.className = 'textpanel';
  const scrolled = document.createElement('div');
  scrolled.className = 'scrolled-content';
  scrolled.style.paddingLeft = `${paddingLeft}px`;
  const text = document.createElement('div');
  text.className = 'hymn-text';

  stanzaWidths.forEach((w) => {
    const stanza = document.createElement('div');
    stanza.className = 'stanza';
    stubWidth(stanza, w);
    text.appendChild(stanza);
  });

  scrolled.appendChild(text);
  panel.appendChild(scrolled);
  document.body.appendChild(panel);

  stubWidth(panel, panelWidth);
  return { panel, ref: { current: text }, text };
}

describe('useCenterByWidest', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('centres on the content box, not the raw panel width', () => {
    const { ref, text } = buildPanel({ panelWidth: 960, paddingLeft: 32, stanzaWidths: [400, 320] });

    renderHook(() => useCenterByWidest(ref, [], { observeResize: false }));

    // Content box = 960 - 32 = 928; centring a 400px block leaves 264px each
    // side. Centring on the raw 960 would give 280px — that is the bug.
    expect(text.style.width).toBe('400px');
    expect(text.style.marginLeft).toBe('264px');
  });

  it('never goes negative when the text is wider than the panel', () => {
    const { ref, text } = buildPanel({ panelWidth: 400, paddingLeft: 32, stanzaWidths: [900] });

    renderHook(() => useCenterByWidest(ref, [], { observeResize: false }));

    expect(text.style.marginLeft).toBe('0px');
  });
});
