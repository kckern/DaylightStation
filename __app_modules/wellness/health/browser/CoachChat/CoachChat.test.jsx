// frontend/src/modules/Health/CoachChat/CoachChat.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { CoachChat } from "./index.jsx";

describe('CoachChat', () => {
  it('renders without throwing when no messages', () => {
    render(
      <MantineProvider>
        <CoachChat userId="kc" />
      </MantineProvider>
    );
    // The composer's textarea/contenteditable should be findable
    const composer = document.querySelector('[role="textbox"], textarea');
    expect(composer).toBeTruthy();
  });
});

describe('CoachChat — mentions', () => {
  it('loads suggestions through the authenticated API and cancels the old user’s request', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      if (String(url).includes('mentions/all?user=person%20A')) {
        return new Promise((_, reject) => {
          options.signal.addEventListener('abort', () => reject(new DOMException('Request cancelled', 'AbortError')), { once: true });
        });
      }
      return new Response('{"suggestions":[]}');
    });
    try {
      const chat = user => <MantineProvider><CoachChat userId={user} /></MantineProvider>;
      const { rerender } = render(chat('person A'));
      const requestFor = name => fetch.mock.calls.find(([url]) => String(url).includes('mentions/all?user=' + name));
      await waitFor(() => expect(requestFor('person%20A')?.[1]?.headers['X-Daylight-Device']).toBeTruthy());
      expect(requestFor('person%20A')[1]).toMatchObject({ method: 'GET', signal: expect.any(AbortSignal) });
      expect(requestFor('person%20A')[1]).not.toHaveProperty('body');
      const signal = requestFor('person%20A')[1].signal;
      rerender(chat('person B'));
      await waitFor(() => expect(requestFor('person%20B')?.[1]?.method).toBe('GET'));
      expect(signal.aborted).toBe(true);
    } finally {
      fetch.mockRestore();
    }
  });
});
