// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { FilesystemDebriefAudio } from './FilesystemDebriefAudio.mjs';

describe('FilesystemDebriefAudio', () => {
  const audio = new FilesystemDebriefAudio({ rootDir: '/nonexistent-debrief-root' });
  it('rejects a traversal learnerId on save', async () => {
    await expect(audio.save({ learnerId: '../x', studyDay: '2026-10-21', buffer: Buffer.alloc(1), mimeType: 'audio/webm' })).rejects.toThrow(/learnerId/);
  });
  it('returns null for a traversal learnerId on read', () => {
    expect(audio.read('../x', '2026-10-21-1.webm')).toBeNull();
  });
});
