import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MantineProvider } from '@mantine/core';
import { AgentChatSurface, AgentConversationProvider, useAgentConversation } from "./AgentChatSurface.jsx";
import { Sheet } from "../../../../frontend/src/lib/ui/Sheet.jsx";
import { DismissStackProvider } from "../../../../frontend/src/lib/ui/dismiss/DismissStackProvider.jsx";

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

  it('starter prompts fill the draft without sending an AI request', async () => {
    render(<MantineProvider><AgentChatSurface agentId="health-coach" userId="kc" starterPrompts={['Review my day']} /></MantineProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review my day' }));
    await waitFor(() => expect(screen.getByRole('textbox').value).toBe('Review my day'));
    expect(screen.getByRole('button', { name: 'Send message' })).toBeTruthy();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('applies coach-chat--overlay when variant="overlay"', () => {
    const { container } = render(
      <MantineProvider>
        <AgentChatSurface agentId="health-coach" userId="kc" variant="overlay" />
      </MantineProvider>
    );
    expect(container.querySelector('.coach-chat--overlay')).toBeTruthy();
  });

  it.each([false, true])('lets overlay Escape dismiss without clearing the draft (mentions=%s)', async withMentions => {
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
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(input.value).toBe('Keep this draft');
  });

  it('preserves a real thread while its view is closed and replaced', async () => {
    const onComplete = vi.fn();
    globalThis.fetch = vi.fn(async () => new Response(
      'data: {"type":"text-delta","text":"Retained answer"}\n\ndata: {"type":"done"}\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    ));
    function Flow() {
      const conversation = useAgentConversation({ agentId: 'fixture', userId: 'fixture', onComplete });
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
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('does not refresh app resources when a stream finishes after its conversation owner leaves', async () => {
    const onComplete = vi.fn();
    let finish;
    const body = new ReadableStream({ start(controller) { finish = () => controller.close(); } });
    globalThis.fetch = vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
    const { unmount } = render(<MantineProvider>
      <AgentChatSurface agentId="health-coach" userId="fixture" onComplete={onComplete} />
    </MantineProvider>);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Review this fixture' } });
    fireEvent.submit(input.closest('form'));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => finish());
    expect(onComplete).not.toHaveBeenCalled();
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
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url) => {
      if (typeof url === 'string' && url.includes('/health/mentions/')) {
        return Response.json({
          suggestions: [
            { slug: 'last_30d', label: 'Last 30 days', description: 'rolling', group: 'period' },
            { slug: 'weight_lbs', label: 'Weight (lbs)', description: 'metric', group: 'metric_snapshot' },
          ],
        });
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

  it('loads mention suggestions through the authenticated API on mount', async () => {
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
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining(mentions.fetchUrl),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'X-Daylight-Device': expect.any(String) }),
        signal: expect.any(AbortSignal),
      }),
    ));
    expect(globalThis.fetch.mock.calls[0][1]).not.toHaveProperty('body');
  });

  it('does not fetch suggestions when mentions prop is absent', async () => {
    render(
      <MantineProvider>
        <AgentChatSurface agentId="lifeplan-guide" userId="default" />
      </MantineProvider>
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
