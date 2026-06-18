import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React, { createRef } from 'react';
import RecordingBar from './RecordingBar.jsx';

const baseProps = {
  weekLabel: 'Week of Apr 1 – Apr 8', isRecording: true, duration: 5,
  micLevelRef: createRef(), silenceWarning: false, uploading: false,
  existingRecording: null, error: null, syncStatus: null, pendingCount: 0,
  lastAckedAt: null, micConnected: true,
};

describe('RecordingBar', () => {
  it('shows a spoken-aloud prompt when silence is detected', () => {
    render(<RecordingBar {...baseProps} silenceWarning={true} />);
    expect(screen.getByText(/can't hear you/i)).toBeInTheDocument();
  });

  it('does not show the silence prompt when audio is fine', () => {
    render(<RecordingBar {...baseProps} silenceWarning={false} />);
    expect(screen.queryByText(/can't hear you/i)).toBeNull();
  });
});
