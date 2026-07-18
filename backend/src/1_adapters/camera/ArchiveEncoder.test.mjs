/**
 * Encoder argument-construction tests. No ffmpeg is invoked.
 *
 * The scale filter matters more than it looks: the driveway is a dual-lens
 * panoramic at 1536x432 (3.55:1), so a naive `scale=W:H` against a 16:9 target
 * silently squashes every frame — a defect you would only notice by watching
 * the output months later.
 */

import { describe, it, expect } from 'vitest';
import { scaleFilter, extractAudio } from './ArchiveEncoder.mjs';

describe('scaleFilter', () => {
  it('fits within the box instead of forcing exact dimensions', () => {
    const f = scaleFilter('854x480');
    expect(f).toContain('scale=854:480:force_original_aspect_ratio=decrease');
  });

  it('keeps output dimensions even, which h264 requires', () => {
    expect(scaleFilter('1280x720')).toContain('trunc(iw/2)*2:trunc(ih/2)*2');
  });

  it('rejects a malformed scale rather than emitting a broken filter', () => {
    expect(() => scaleFilter('720p')).toThrow(/Invalid scale/);
    expect(() => scaleFilter('')).toThrow(/Invalid scale/);
  });
});

describe('extractAudio guards', () => {
  it('refuses silenceRemove with stream-copy, which ffmpeg cannot do', async () => {
    await expect(
      extractAudio({
        inputPath: '/tmp/in.mp4',
        outPath: '/tmp/out.m4a',
        profile: { audioCodec: 'copy', silenceRemove: true },
      }),
    ).rejects.toThrow(/silenceRemove requires re-encoding/);
  });
});
