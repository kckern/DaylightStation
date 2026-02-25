import { describe, it, expect, vi } from 'vitest';

describe('ScriptureResolver — deriveTextFromAudio', () => {
  it('derives esv text from esv-music audio slug', async () => {
    const { ScriptureResolver } = await import(
      '#adapters/content/readalong/resolvers/scripture.mjs'
    );

    const dataPath = process.env.DAYLIGHT_DATA_PATH
      ? `${process.env.DAYLIGHT_DATA_PATH}/content/readalong/scripture`
      : null;
    const mediaPath = process.env.DAYLIGHT_MEDIA_PATH
      ? `${process.env.DAYLIGHT_MEDIA_PATH}/audio/readalong/scripture`
      : null;

    if (!dataPath || !mediaPath) {
      console.log('SKIP: data paths not configured');
      return;
    }

    const result = ScriptureResolver.resolve('esv-music/1', dataPath, {
      mediaPath,
      defaults: { ot: { text: 'kjvf', audio: 'kjv-maxmclean' } },
      audioDefaults: { kjvf: 'kjv-maxmclean' }
    });

    expect(result).toBeTruthy();
    expect(result.volume).toBe('ot');
    expect(result.verseId).toBe('1');
    expect(result.audioRecording).toBe('esv-music');
    expect(result.textVersion).toBe('esv');
    expect(result.textPath).toBe('ot/esv/1');
    expect(result.audioPath).toBe('ot/esv-music/1');
  });

  it('falls back to volume default when suffix-strip finds no text dir', async () => {
    const { ScriptureResolver } = await import(
      '#adapters/content/readalong/resolvers/scripture.mjs'
    );

    const dataPath = process.env.DAYLIGHT_DATA_PATH
      ? `${process.env.DAYLIGHT_DATA_PATH}/content/readalong/scripture`
      : null;
    const mediaPath = process.env.DAYLIGHT_MEDIA_PATH
      ? `${process.env.DAYLIGHT_MEDIA_PATH}/audio/readalong/scripture`
      : null;

    if (!dataPath || !mediaPath) return;

    const result = ScriptureResolver.resolve('kjv-glyn/1', dataPath, {
      mediaPath,
      defaults: { ot: { text: 'kjvf', audio: 'kjv-maxmclean' } },
      audioDefaults: {}
    });

    expect(result).toBeTruthy();
    expect(result.audioRecording).toBe('kjv-glyn');
    expect(result.textVersion).toBe('kjvf');
  });
});
