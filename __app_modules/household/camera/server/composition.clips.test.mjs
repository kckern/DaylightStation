// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createCameraClipSourceResolver } from './composition.mjs';
import { CameraService } from './application/CameraService.mjs';

const configService = ({ cameras = [{ id: 'porch', nvrChannel: 1 }], auth = { username: 'u', password: 'p' } } = {}) => ({
  getHouseholdAppConfig: () => ({ cameras }),
  getDeviceConfig: (id) => ({ host: `${id}.invalid`, auth_ref: 'cam' }),
  getHouseholdAuth: () => auth,
});
const logger = () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn() });
const factories = { createReolinkClient: vi.fn((o) => ({ host: o.host })), makeSource: vi.fn((spec) => ({ kind: spec.kind, host: spec.client.host })) };

describe('camera clip source resolver', () => {
  it('returns the camera-side source for a camera in the archive plan', () => {
    const open = createCameraClipSourceResolver({ configService: configService(), householdId: 'h', logger: logger(), factories });
    expect(open('porch')).toEqual({ kind: 'camera', host: 'porch.invalid' });
  });
  it('returns null and logs when the camera is not in the plan or credentials are missing', () => {
    const log = logger();
    expect(createCameraClipSourceResolver({ configService: configService(), householdId: 'h', logger: log, factories })('attic')).toBeNull();
    expect(createCameraClipSourceResolver({ configService: configService({ auth: null }), householdId: 'h', logger: log, factories })('porch')).toBeNull();
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(log.warn.mock.calls[1][1]).toMatchObject({ camera: 'porch', reason: 'CAMERA_AUTH_UNAVAILABLE' });
  });
});

describe('CameraService clips', () => {
  const base = { gateway: { listCameras: () => [], getCamera: () => null, fetchSnapshot: vi.fn(), getStreamUrl: vi.fn() }, streamAdapter: { ensureStream: vi.fn(), readPlaylist: vi.fn(), readSegment: vi.fn(), touch: vi.fn(), stop: vi.fn(), isActive: vi.fn(), stopAll: vi.fn() } };
  it('is unavailable without a clip library', async () => {
    const s = new CameraService({ ...base, logger: logger() });
    await expect(s.listClips('porch', '2026-10-28')).rejects.toMatchObject({ name: 'OperationUnavailableError' });
    await expect(s.getClip('porch', 'x')).rejects.toMatchObject({ name: 'OperationUnavailableError' });
  });
  it('rejects a malformed day and delegates a good one', async () => {
    const clipLibrary = { listClips: vi.fn().mockResolvedValue([]), openClip: vi.fn() };
    const s = new CameraService({ ...base, clipLibrary, logger: logger() });
    await expect(s.listClips('porch', 'yesterday')).rejects.toMatchObject({ name: 'ValidationError' });
    await s.listClips('porch', '2026-10-28');
    expect(clipLibrary.listClips).toHaveBeenCalledWith({ cameraId: 'porch', day: '2026-10-28' });
  });
});
