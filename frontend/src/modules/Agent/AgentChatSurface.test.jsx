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
