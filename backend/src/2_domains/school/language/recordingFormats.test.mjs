import { describe, it, expect } from 'vitest';
import { RECORDING_FORMATS, isRecordingFormat } from './recordingFormats.mjs';

describe('recording formats', () => {
  it('lists webm first (a one-go take) and includes wav (a joined take)', () => {
    expect(RECORDING_FORMATS[0]).toBe('webm');
    expect(RECORDING_FORMATS).toContain('wav');
  });

  it('accepts a listed format in any case and nothing else', () => {
    expect(isRecordingFormat('WAV')).toBe(true);
    expect(isRecordingFormat('aac')).toBe(false);
    expect(isRecordingFormat('')).toBe(false);
    expect(isRecordingFormat(undefined)).toBe(false);
  });
});
