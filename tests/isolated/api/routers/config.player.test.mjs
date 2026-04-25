import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createConfigRouter } from '../../../../backend/src/4_api/v1/routers/config.mjs';

function makeLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

describe('GET /api/v1/config/player', () => {
  it('returns on_deck config from player.yml', async () => {
    const app = express();
    app.use('/api/v1/config', createConfigRouter({
      dataPath: '/opt/Code/DaylightStation-on-deck/data',
      logger: makeLogger(),
    }));
    const res = await request(app).get('/api/v1/config/player');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ on_deck: { preempt_seconds: 15, displace_to_queue: false } });
  });

  it('returns defaults when config file is missing', async () => {
    const app = express();
    app.use('/api/v1/config', createConfigRouter({
      dataPath: `/tmp/nonexistent-data-${Date.now()}`,
      logger: makeLogger(),
    }));
    const res = await request(app).get('/api/v1/config/player');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ on_deck: { preempt_seconds: 15, displace_to_queue: false } });
  });

  it('clamps preempt_seconds to [0, 600]', async () => {
    const fs = await import('node:fs/promises');
    const tmpDir = `/tmp/on-deck-test-${Date.now()}`;
    await fs.mkdir(`${tmpDir}/household/config`, { recursive: true });
    await fs.writeFile(
      `${tmpDir}/household/config/player.yml`,
      'on_deck:\n  preempt_seconds: 99999\n  displace_to_queue: true\n',
    );

    const app = express();
    app.use('/api/v1/config', createConfigRouter({
      dataPath: tmpDir,
      logger: makeLogger(),
    }));
    const res = await request(app).get('/api/v1/config/player');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ on_deck: { preempt_seconds: 600, displace_to_queue: true } });

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('clamps preempt_seconds to 0 when negative', async () => {
    const fs = await import('node:fs/promises');
    const tmpDir = `/tmp/on-deck-test-${Date.now()}`;
    await fs.mkdir(`${tmpDir}/household/config`, { recursive: true });
    await fs.writeFile(
      `${tmpDir}/household/config/player.yml`,
      'on_deck:\n  preempt_seconds: -5\n  displace_to_queue: false\n',
    );

    const app = express();
    app.use('/api/v1/config', createConfigRouter({
      dataPath: tmpDir,
      logger: makeLogger(),
    }));
    const res = await request(app).get('/api/v1/config/player');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ on_deck: { preempt_seconds: 0, displace_to_queue: false } });

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('uses default preempt_seconds when value is non-numeric', async () => {
    const fs = await import('node:fs/promises');
    const tmpDir = `/tmp/on-deck-test-${Date.now()}`;
    await fs.mkdir(`${tmpDir}/household/config`, { recursive: true });
    await fs.writeFile(
      `${tmpDir}/household/config/player.yml`,
      'on_deck:\n  preempt_seconds: "not-a-number"\n  displace_to_queue: false\n',
    );

    const app = express();
    app.use('/api/v1/config', createConfigRouter({
      dataPath: tmpDir,
      logger: makeLogger(),
    }));
    const res = await request(app).get('/api/v1/config/player');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ on_deck: { preempt_seconds: 15, displace_to_queue: false } });

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('uses default displace_to_queue when value is non-boolean', async () => {
    const fs = await import('node:fs/promises');
    const tmpDir = `/tmp/on-deck-test-${Date.now()}`;
    await fs.mkdir(`${tmpDir}/household/config`, { recursive: true });
    await fs.writeFile(
      `${tmpDir}/household/config/player.yml`,
      'on_deck:\n  preempt_seconds: 10\n  displace_to_queue: "yes"\n',
    );

    const app = express();
    app.use('/api/v1/config', createConfigRouter({
      dataPath: tmpDir,
      logger: makeLogger(),
    }));
    const res = await request(app).get('/api/v1/config/player');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ on_deck: { preempt_seconds: 10, displace_to_queue: false } });

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns full defaults when on_deck block is missing', async () => {
    const fs = await import('node:fs/promises');
    const tmpDir = `/tmp/on-deck-test-${Date.now()}`;
    await fs.mkdir(`${tmpDir}/household/config`, { recursive: true });
    await fs.writeFile(
      `${tmpDir}/household/config/player.yml`,
      '# empty player config\nsome_other_key: 42\n',
    );

    const app = express();
    app.use('/api/v1/config', createConfigRouter({
      dataPath: tmpDir,
      logger: makeLogger(),
    }));
    const res = await request(app).get('/api/v1/config/player');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ on_deck: { preempt_seconds: 15, displace_to_queue: false } });

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('warns on load failure and returns defaults', async () => {
    const logger = makeLogger();
    const fs = await import('node:fs/promises');
    const tmpDir = `/tmp/on-deck-test-${Date.now()}`;
    await fs.mkdir(`${tmpDir}/household/config`, { recursive: true });
    // Write a directory where the file should be so loadYaml throws
    await fs.mkdir(`${tmpDir}/household/config/player.yml`, { recursive: true });

    const app = express();
    app.use('/api/v1/config', createConfigRouter({
      dataPath: tmpDir,
      logger,
    }));
    const res = await request(app).get('/api/v1/config/player');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ on_deck: { preempt_seconds: 15, displace_to_queue: false } });
    expect(logger.warn).toHaveBeenCalledWith('config.player.load-failed', expect.objectContaining({ error: expect.anything() }));

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
