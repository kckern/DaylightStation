// tests/unit/suite/adapters/AdbLauncher.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { AdbLauncher } from '#adapters/devices/AdbLauncher.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

describe('AdbLauncher', () => {
  let launcher;
  let mockConfigService;
  let mockAdb;

  beforeEach(() => {
    mockAdb = {
      connect: jest.fn().mockResolvedValue({ ok: true }),
      amStart: jest.fn().mockResolvedValue({ ok: true, output: 'Starting: Intent' })
    };

    mockConfigService = {
      getDeviceConfig: jest.fn().mockReturnValue({
        content_control: { fallback: { provider: 'adb', host: '10.0.0.11', port: 5555 } }
      })
    };

    launcher = new AdbLauncher({
      configService: mockConfigService,
      createAdb: jest.fn().mockReturnValue(mockAdb),
      logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }
    });
  });

  describe('canLaunch', () => {
    it('returns true when device has adb config', async () => {
      expect(await launcher.canLaunch('shield-tv')).toBe(true);
    });

    it('returns false when device has no adb config', async () => {
      mockConfigService.getDeviceConfig.mockReturnValue({});
      expect(await launcher.canLaunch('phone')).toBe(false);
    });

    it('returns false when device not found', async () => {
      mockConfigService.getDeviceConfig.mockReturnValue(null);
      expect(await launcher.canLaunch('unknown')).toBe(false);
    });
  });

  describe('launch', () => {
    const intent = {
      target: 'com.retroarch.aarch64/com.retroarch.browser.retroactivity.RetroActivityFuture',
      params: {
        ROM: '/storage/emulated/0/Games/N64/Mario Kart 64 (USA).n64',
        LIBRETRO: '/data/local/tmp/mupen64plus_next_gles3_libretro_android.so'
      }
    };

    it('connects and executes amStart with array args', async () => {
      await launcher.launch('shield-tv', intent);

      expect(mockAdb.connect).toHaveBeenCalled();
      expect(mockAdb.amStart).toHaveBeenCalledWith([
        'start', '-n', intent.target,
        '--es', 'ROM', `'${intent.params.ROM}'`,
        '--es', 'LIBRETRO', `'${intent.params.LIBRETRO}'`
      ]);
    });

    it('rejects intent params with shell metacharacters', async () => {
      const maliciousIntent = {
        target: 'com.example/Activity',
        params: { ROM: '/path/to/rom; rm -rf /' }
      };

      await expect(launcher.launch('shield-tv', maliciousIntent))
        .rejects.toThrow(ValidationError);
    });

    it('allows single quotes in params (e.g., Kirby\'s Adventure)', async () => {
      const quoteIntent = {
        target: 'com.example/Activity',
        params: { ROM: "/path/to/Kirby's Adventure.nes" }
      };

      await launcher.launch('shield-tv', quoteIntent);
      expect(mockAdb.amStart).toHaveBeenCalledWith(
        expect.arrayContaining(["--es", "ROM", "'/path/to/Kirby'\\''s Adventure.nes'"])
      );
    });
  });
});
