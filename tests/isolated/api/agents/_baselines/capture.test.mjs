/**
 * Baseline capture for OpenAIChatCompletionsTranslator wire format.
 *
 * Both tests are permanently skipped after initial capture. To re-capture:
 *   1. Change `it.skip` → `it` for both tests
 *   2. Run: npx vitest run tests/isolated/api/agents/_baselines/capture.test.mjs
 *   3. Verify the two output files look correct
 *   4. Restore `it.skip`
 *
 * The captured files are the golden masters for Phase 3 Task 7
 * (wireFormats/openaiChatCompletions.mjs).
 */

import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { OpenAIChatCompletionsTranslator } from '../../../../../backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const silentLogger = {
  info: () => {},
  warn: () => {},
  debug: () => {},
  error: () => {},
};

// ---------------------------------------------------------------------------
// Fake runner — deterministic, covers all event types the translator handles
// ---------------------------------------------------------------------------
class FakeRunner {
  async runChat() {
    return {
      content: 'Hello from the kitchen.',
      toolCalls: [],
      usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
    };
  }

  async *streamChat() {
    yield { type: 'text-delta', text: 'Hello' };
    yield { type: 'tool-start', toolName: 'remember_note', args: { text: 'pizza tonight' } };
    yield { type: 'tool-end', toolName: 'remember_note', result: { ok: true } };
    yield { type: 'text-delta', text: ' from' };
    yield { type: 'text-delta', text: ' the kitchen.' };
    yield { type: 'finish', reason: 'stop' };
  }
}

// ---------------------------------------------------------------------------
// Fake response objects
// ---------------------------------------------------------------------------
function streamingFakeRes() {
  const writes = [];
  const headers = {};
  return {
    setHeader(h, v) { headers[h] = v; return this; },
    status() { return this; },
    write(d) { writes.push(d); return true; },
    end() {},
    flushHeaders() {},
    on() { return this; },
    _state: () => ({ writes, headers }),
  };
}

function fakeRes() {
  let body = null;
  let statusCode = 200;
  const headers = {};
  return {
    setHeader(h, v) { headers[h] = v; return this; },
    status(s) { statusCode = s; return this; },
    json(b) { body = b; return this; },
    _state: () => ({ statusCode, body, headers }),
  };
}

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------
const SATELLITE = { id: 'kitchen', area: 'kitchen', allowedSkills: ['memory'] };
const BASE_MESSAGES = [{ role: 'user', content: 'hi' }];

// ---------------------------------------------------------------------------
// Redaction helpers — strip non-deterministic fields before saving
// ---------------------------------------------------------------------------
function redactSseBlob(blob) {
  return blob
    .replace(/"id":"chatcmpl-[^"]+"/g, '"id":"chatcmpl-{UUID}"')
    .replace(/"created":\d+/g, '"created":{TS}');
}

function redactSyncBody(body) {
  // Mutate non-deterministic fields on the object directly (avoids JSON
  // round-trip issues with numeric `created` becoming string sentinel).
  const clone = JSON.parse(JSON.stringify(body));
  clone.id = 'chatcmpl-{UUID}';
  clone.created = '{TS}';
  return clone;
}

// ---------------------------------------------------------------------------
// Capture tests — SKIP after initial capture
// ---------------------------------------------------------------------------
describe('OpenAI Chat Completions — wire-format baseline capture', () => {
  it.skip('captures SSE stream baseline', async () => {
    const tx = new OpenAIChatCompletionsTranslator({
      runner: new FakeRunner(),
      logger: silentLogger,
      mediaLogsDir: null,
    });
    const req = {
      body: {
        model: 'daylight-house',
        messages: BASE_MESSAGES,
        stream: true,
      },
    };
    const res = streamingFakeRes();
    await tx.handle(req, res, SATELLITE);

    const blob = redactSseBlob(res._state().writes.join(''));
    const outPath = join(__dirname, 'openai-chat-completions-sse.txt');
    writeFileSync(outPath, blob, 'utf8');
    console.log(`SSE baseline written → ${outPath} (${blob.length} bytes)`);
  });

  it.skip('captures sync (non-stream) baseline', async () => {
    const tx = new OpenAIChatCompletionsTranslator({
      runner: new FakeRunner(),
      logger: silentLogger,
      mediaLogsDir: null,
    });
    const req = {
      body: {
        model: 'daylight-house',
        messages: BASE_MESSAGES,
        stream: false,
      },
    };
    const res = fakeRes();
    await tx.handle(req, res, SATELLITE);

    const redacted = redactSyncBody(res._state().body);
    const outPath = join(__dirname, 'openai-chat-completions-sync.json');
    writeFileSync(outPath, JSON.stringify(redacted, null, 2), 'utf8');
    console.log(`Sync baseline written → ${outPath}`);
  });
});
