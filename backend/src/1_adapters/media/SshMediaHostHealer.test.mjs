import { describe, expect, it, vi } from 'vitest';
import { SshMediaHostHealer } from './SshMediaHostHealer.mjs';

const CONFIG = {
  host: '172.19.0.1',
  user: 'ds',
  privateKey: 'data/system/ssh/media-heal_ed25519',
  knownHostsPath: 'data/system/ssh/known_hosts',
  pathMap: [
    { from: '/data/media/video/fitness', to: '/media/kckern/Media/Fitness' },
    { from: '/data/media/video', to: '/media/kckern/Media/Video' },
  ],
};

function withExec(impl) {
  const execFile = vi.fn(impl);
  return { healer: new SshMediaHostHealer(CONFIG, { execFile, logger: { warn: vi.fn() } }), execFile };
}

describe('SshMediaHostHealer', () => {
  it('maps Plex paths to host paths by longest prefix, on segment boundaries', () => {
    const { healer } = withExec(() => {});
    expect(healer.toHostPath('/data/media/video/fitness/Max Built/Back 1.mp4'))
      .toBe('/media/kckern/Media/Fitness/Max Built/Back 1.mp4');
    expect(healer.toHostPath('/data/media/video/tv/x.mp4')).toBe('/media/kckern/Media/Video/tv/x.mp4');
    expect(healer.toHostPath('/data/media/video/fitnessX/a.mp4')).toBe('/media/kckern/Media/Video/fitnessX/a.mp4');
    expect(healer.toHostPath('/data/media/audio/a.mp3')).toBeNull();
  });

  it('sends the host path base64-encoded as the only remote argument, with no shell', async () => {
    const { healer, execFile } = withExec((cmd, args, opts, cb) => cb(null, '{"ok":true,"exists":true,"mode":"0","chmodApplied":true,"siblingsFixed":3,"readable":true}\n', ''));
    const result = await healer.heal('/data/media/video/fitness/Max Built/It\'s "Back" & 1.mp4');

    expect(result).toMatchObject({ ok: true, chmodApplied: true, siblingsFixed: 3 });
    const [cmd, args] = execFile.mock.calls[0];
    expect(cmd).toBe('ssh');
    expect(args).toContain('ds@172.19.0.1');
    expect(args).toContain('UserKnownHostsFile=data/system/ssh/known_hosts');
    const encoded = args[args.length - 1];
    expect(Buffer.from(encoded, 'base64').toString('utf8'))
      .toBe('/media/kckern/Media/Fitness/Max Built/It\'s "Back" & 1.mp4');
    expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('refuses a path no mapping covers without calling ssh', async () => {
    const { healer, execFile } = withExec(() => {});
    expect(await healer.heal('/etc/passwd')).toEqual({ ok: false, error: 'unmapped-path' });
    expect(execFile).not.toHaveBeenCalled();
  });

  it('reports ssh failures and unparseable output as not ok', async () => {
    const failing = withExec((cmd, args, opts, cb) => cb(Object.assign(new Error('x'), { code: 255 }), '', 'Permission denied'));
    expect(await failing.healer.heal('/data/media/video/fitness/a.mp4')).toEqual({ ok: false, error: 'ssh-failed' });
    const garbled = withExec((cmd, args, opts, cb) => cb(null, 'not json', ''));
    expect(await garbled.healer.heal('/data/media/video/fitness/a.mp4')).toEqual({ ok: false, error: 'bad-response' });
  });

  it('is not configured without a key or a path map', () => {
    expect(new SshMediaHostHealer({ ...CONFIG, privateKey: '' }).isConfigured()).toBe(false);
    expect(new SshMediaHostHealer({ ...CONFIG, pathMap: [] }).isConfigured()).toBe(false);
    expect(new SshMediaHostHealer(CONFIG).isConfigured()).toBe(true);
  });
});
