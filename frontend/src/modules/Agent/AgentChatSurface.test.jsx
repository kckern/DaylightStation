import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { AgentChatSurface } from './AgentChatSurface.jsx';

describe('AgentChatSurface — basic rendering', () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ output: '', toolCalls: [] }) }));
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('renders without throwing for any agentId', () => {
    render(
      <MantineProvider>
        <AgentChatSurface agentId="echo" userId="kc" />
      </MantineProvider>
    );
    const composer = document.querySelector('[role="textbox"], textarea');
    expect(composer).toBeTruthy();
  });

  it('applies the coach-chat root class', () => {
    const { container } = render(
      <MantineProvider>
        <AgentChatSurface agentId="health-coach" userId="kc" />
      </MantineProvider>
    );
    expect(container.querySelector('.coach-chat')).toBeTruthy();
  });

  it('applies coach-chat--overlay when variant="overlay"', () => {
    const { container } = render(
      <MantineProvider>
        <AgentChatSurface agentId="health-coach" userId="kc" variant="overlay" />
      </MantineProvider>
    );
    expect(container.querySelector('.coach-chat--overlay')).toBeTruthy();
  });

  it('does NOT apply coach-chat--overlay for the default (light) variant', () => {
    const { container } = render(
      <MantineProvider>
        <AgentChatSurface agentId="health-coach" userId="kc" />
      </MantineProvider>
    );
    expect(container.querySelector('.coach-chat--overlay')).toBeFalsy();
  });

  it('passes inline style through to root div', () => {
    const { container } = render(
      <MantineProvider>
        <AgentChatSurface agentId="echo" userId="kc" style={{ height: '500px' }} />
      </MantineProvider>
    );
    const root = container.querySelector('.coach-chat');
    expect(root.style.height).toBe('500px');
  });
});

describe('AgentChatSurface — no mentions when prop omitted', () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ output: '', toolCalls: [] }) }));
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('omits the mention popover when mentions prop is absent', () => {
    const { container } = render(
      <MantineProvider>
        <AgentChatSurface agentId="lifeplan-guide" userId="default" />
      </MantineProvider>
    );
    expect(container.querySelector('.coach-chat__mention-popover')).toBeFalsy();
  });

  it('still renders the composer + send button when mentions prop is absent', () => {
    const { container } = render(
      <MantineProvider>
        <AgentChatSurface agentId="lifeplan-guide" userId="default" />
      </MantineProvider>
    );
    expect(container.querySelector('.coach-chat__composer')).toBeTruthy();
    expect(container.querySelector('.coach-chat__send')).toBeTruthy();
  });
});

describe('AgentChatSurface — mentions prop wiring', () => {
  let originalFetch;
  let fetchCalls;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchCalls = [];
    globalThis.fetch = vi.fn(async (url) => {
      fetchCalls.push(url);
      if (typeof url === 'string' && url.includes('/health/mentions/')) {
        return {
          ok: true,
          json: async () => ({
            suggestions: [
              { slug: 'last_30d', label: 'Last 30 days', description: 'rolling', group: 'period' },
              { slug: 'weight_lbs', label: 'Weight (lbs)', description: 'metric', group: 'metric_snapshot' },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({ output: '', toolCalls: [] }) };
    });
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('renders the mention popover root when mentions prop is present', async () => {
    const mentions = {
      fetchUrl: '/api/v1/health/mentions/all?user=kc',
      categories: [
        { key: 'period', label: 'Period', icon: null },
        { key: 'metric_snapshot', label: 'Metric', icon: null },
      ],
      buildAttachment: (s) => ({ type: s.group, value: s.slug, label: s.label }),
    };
    const { container } = render(
      <MantineProvider>
        <AgentChatSurface agentId="health-coach" userId="kc" mentions={mentions} />
      </MantineProvider>
    );
    expect(container.querySelector('.coach-chat__mention-popover, [data-mention-popover]')).toBeTruthy();
  });

  it('fetches the mention suggestions URL on mount when mentions prop is present', async () => {
    const mentions = {
      fetchUrl: '/api/v1/health/mentions/all?user=kc',
      categories: [{ key: 'period', label: 'Period', icon: null }],
      buildAttachment: (s) => ({ type: s.group, value: s.slug, label: s.label }),
    };
    render(
      <MantineProvider>
        <AgentChatSurface agentId="health-coach" userId="kc" mentions={mentions} />
      </MantineProvider>
    );
    await new Promise(r => setTimeout(r, 10));
    expect(fetchCalls.some(u => typeof u === 'string' && u.includes('/health/mentions/'))).toBe(true);
  });

  it('does not fetch suggestions when mentions prop is absent', async () => {
    render(
      <MantineProvider>
        <AgentChatSurface agentId="lifeplan-guide" userId="default" />
      </MantineProvider>
    );
    await new Promise(r => setTimeout(r, 10));
    expect(fetchCalls.filter(u => typeof u === 'string' && u.includes('/mentions/'))).toHaveLength(0);
  });
});
