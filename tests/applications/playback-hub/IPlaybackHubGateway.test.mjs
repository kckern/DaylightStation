import { describe, it, expect } from 'vitest';
import {
  IPlaybackHubGateway,
  isPlaybackHubGateway,
} from "../../../__app_modules/media/server/application/playback-hub/ports/IPlaybackHubGateway.mjs";

describe('IPlaybackHubGateway', () => {
  it('verifyAudio() throws "must be implemented" by default', async () => {
    const g = new IPlaybackHubGateway();
    await expect(g.verifyAudio('red')).rejects.toThrow(
      /verifyAudio must be implemented/
    );
  });

  it('isPlaybackHubGateway requires getStatus, sendCommand, AND verifyAudio', () => {
    expect(isPlaybackHubGateway({
      getStatus: () => {}, sendCommand: () => {}, verifyAudio: () => {},
    })).toBe(true);
    expect(isPlaybackHubGateway({
      getStatus: () => {}, sendCommand: () => {},
    })).toBe(false);
    expect(isPlaybackHubGateway(null)).toBe(false);
  });
});
