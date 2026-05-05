// frontend/src/modules/Health/CoachChat/CoachChat.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { CoachChat } from './index.jsx';

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
