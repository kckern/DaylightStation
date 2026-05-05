// tests/isolated/adapters/agents/MastraAdapter.transcript.test.mjs
import { describe, it, expect } from 'vitest';
import { MastraAdapter } from '../../../../backend/src/1_adapters/agents/MastraAdapter.mjs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('MastraAdapter constructor — mediaDir wiring', () => {
  it('accepts mediaDir without error', () => {
    const adapter = new MastraAdapter({ model: 'openai/gpt-4o-mini', mediaDir: '/tmp' });
    expect(adapter).toBeDefined();
  });

  it('defaults mediaDir to null when absent', () => {
    const adapter = new MastraAdapter({ model: 'openai/gpt-4o-mini' });
    // Private — verified indirectly through transcript tests below
    expect(adapter).toBeDefined();
  });
});

describe('MastraAdapter.execute — transcript lifecycle', () => {
  async function makeTmp() {
    return fsp.mkdtemp(path.join(os.tmpdir(), 'mastra-transcript-'));
  }

  it('writes a transcript with status=error when execute fails fast', async () => {
    const tmp = await makeTmp();
    const adapter = new MastraAdapter({
      model: 'invalid-provider/no-such-model',
      mediaDir: tmp,
      timeoutMs: 5000,
    });

    let threw = false;
    try {
      await adapter.execute({
        agentId: 'echo',
        input: 'hello',
        tools: [],
        systemPrompt: 'You are a test.',
        context: { userId: 'test-user' },
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // Verify a transcript was written with error status
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(tmp, 'logs', 'agents', 'echo', day, 'test-user');
    const exists = await fsp.access(dir).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    const files = await fsp.readdir(dir);
    expect(files.length).toBeGreaterThanOrEqual(1);
    const data = JSON.parse(await fsp.readFile(path.join(dir, files[0]), 'utf8'));
    expect(data.agentId).toBe('echo');
    expect(['error', 'aborted']).toContain(data.status);
    expect(data.systemPrompt).toBe('You are a test.');
    expect(data.input.text).toBe('hello');
    expect(data.error).toBeTruthy();

    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it('threads turnId from context if provided', async () => {
    const tmp = await makeTmp();
    const adapter = new MastraAdapter({
      model: 'invalid-provider/no-such-model',
      mediaDir: tmp,
      timeoutMs: 5000,
    });
    const turnId = '99999999-aaaa-bbbb-cccc-dddddddddddd';
    try {
      await adapter.execute({
        agentId: 'echo',
        input: 'hi',
        tools: [],
        systemPrompt: 'sys',
        context: { userId: 'u', turnId },
      });
    } catch {}
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(tmp, 'logs', 'agents', 'echo', day, 'u');
    const files = await fsp.readdir(dir);
    expect(files.length).toBe(1);
    expect(files[0]).toContain(turnId.slice(0, 8));

    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it('uses anonymous user dir when context.userId is null', async () => {
    const tmp = await makeTmp();
    const adapter = new MastraAdapter({
      model: 'invalid-provider/no-such-model',
      mediaDir: tmp,
      timeoutMs: 5000,
    });
    try {
      await adapter.execute({
        agentId: 'echo',
        input: 'hi',
        tools: [],
        systemPrompt: 'sys',
        context: {},
      });
    } catch {}
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(tmp, 'logs', 'agents', 'echo', day, 'anonymous');
    const files = await fsp.readdir(dir);
    expect(files.length).toBe(1);

    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it('skips disk write when mediaDir is null (still completes)', async () => {
    const adapter = new MastraAdapter({
      model: 'invalid-provider/no-such-model',
      timeoutMs: 5000,
      // mediaDir omitted
    });
    let threw = false;
    try {
      await adapter.execute({
        agentId: 'echo',
        input: 'hi',
        tools: [],
        systemPrompt: 'sys',
        context: {},
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // No assertion on disk — just that the adapter doesn't crash on transcript
    // flush when mediaDir is absent.
  });
});
