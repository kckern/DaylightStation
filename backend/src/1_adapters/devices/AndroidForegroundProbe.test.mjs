// backend/src/1_adapters/devices/AndroidForegroundProbe.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { AndroidForegroundProbe, parseResumedActivity } from './AndroidForegroundProbe.mjs';

describe('parseResumedActivity', () => {
  it('reads package and activity from the dumpsys line captured on the living-room Shield', () => {
    expect(parseResumedActivity('    mResumedActivity: ActivityRecord{241d228 u0 com.android.tv.settings/.accessories.AddAccessoryActivity t10970}'))
      .toEqual({ package: 'com.android.tv.settings', activity: '.accessories.AddAccessoryActivity' });
  });

  it('keeps a fully-qualified activity as printed', () => {
    expect(parseResumedActivity('mResumedActivity: ActivityRecord{c119c84 u0 org.byutv.android/org.byutv.android.MainActivity t10979}'))
      .toEqual({ package: 'org.byutv.android', activity: 'org.byutv.android.MainActivity' });
  });

  it('returns null when nothing is resumed', () => {
    expect(parseResumedActivity('')).toBeNull();
  });
});

describe('AndroidForegroundProbe', () => {
  it('returns null, not a guess, when the shell fails', async () => {
    const probe = new AndroidForegroundProbe({ adbAdapter: { shell: vi.fn(async () => ({ ok: false, error: 'offline' })) }, logger: {} });
    expect(await probe.foreground()).toBeNull();
  });

  it('goes home to return to the kiosk', async () => {
    const shell = vi.fn(async () => ({ ok: true }));
    await new AndroidForegroundProbe({ adbAdapter: { shell } }).returnToKiosk();
    expect(shell).toHaveBeenCalledWith('input keyevent KEYCODE_HOME');
  });
});
