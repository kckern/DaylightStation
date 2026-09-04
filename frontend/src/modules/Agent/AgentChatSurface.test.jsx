import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MantineProvider } from '@mantine/core';
import { AgentChatSurface, AgentConversationProvider, useAgentConversation } from './AgentChatSurface.jsx';
import { Sheet } from '../../lib/ui/Sheet.jsx';
import { DismissStackProvider } from '../../lib/ui/dismiss/DismissStackProvider.jsx';

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

  it.each([false, true])('lets overlay Escape dismiss without clearing the draft (mentions=%s)', withMentions => {
    const onClose = vi.fn();
    render(<MantineProvider><DismissStackProvider>
      <Sheet open title="Coach" onClose={onClose}>
        <AgentChatSurface agentId="health-coach" userId="fixture" variant="overlay"
          mentions={withMentions ? { fetchUrl: '/fixture/mentions', categories: [], buildAttachment: item => item } : undefined} />
      </Sheet>
    </DismissStackProvider></MantineProvider>);
    const input = screen.getByRole('textbox');
    input.focus();
    fireEvent.change(input, { target: { value: 'Keep this draft' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('Keep this draft');
  });

  it('preserves a real thread while its view is closed and replaced', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      'data: {"type":"text-delta","text":"Retained answer"}\n\ndata: {"type":"done"}\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    ));
    function Flow() {
      const conversation = useAgentConversation({ agentId: 'fixture', userId: 'fixture' });
      const [surface, setSurface] = useState('overlay');
      return <AgentConversationProvider conversation={conversation}>
        <button onClick={() => setSurface(null)}>Close view</button>
        <button onClick={() => setSurface('tab')}>Open tab</button>
        {surface ? <AgentChatSurface key={surface} variant={surface === 'overlay' ? 'overlay' : 'light'} /> : null}
      </AgentConversationProvider>;
    }
    render(<MantineProvider><Flow /></MantineProvider>);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Remember this' } });
    fireEvent.submit(input.closest('form'));
    await screen.findByText('Retained answer');
    fireEvent.click(screen.getByText('Close view'));
    expect(screen.queryByText('Retained answer')).toBeNull();
    fireEvent.click(screen.getByText('Open tab'));
    await waitFor(() => expect(screen.getByText('Retained answer')).toBeTruthy());
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
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
