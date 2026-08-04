import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const RELAY = path.join(ROOT, '_extensions', 'ticalc-relay');
const MAIN = readFileSync(path.join(RELAY, 'firmware', 'src', 'main.cpp'), 'utf8');
const AWARENESS_HEADER = readFileSync(path.join(
  RELAY, 'firmware', 'src', 'SchoolCalcTransportAwareness.h',
), 'utf8');
const AWARENESS_SOURCE = readFileSync(path.join(
  RELAY, 'firmware', 'src', 'SchoolCalcTransportAwareness.cpp',
), 'utf8');
const CONFIG_GENERATOR = readFileSync(path.join(
  RELAY, 'firmware', 'tools', 'gen-config.mjs',
), 'utf8');
const CONFIG_EXAMPLE = readFileSync(path.join(RELAY, 'config.example.yml'), 'utf8');

describe('calculator-initiated foreground listener contract', () => {
  it('polls for a start edge while idle and atomically yields to explicit jobs', () => {
    expect(MAIN).toContain('const TickType_t queueWait = listenerAvailable ? 1 : portMAX_DELAY;');
    expect(MAIN).toContain('xQueueReceive(tiJobs, &job, queueWait)');
    expect(MAIN).toMatch(
      /if \(!tiBusy && !tiJobPending\)[\s\S]*?tiBusy = true;[\s\S]*?job = TiJob::ForegroundSync;/,
    );
    expect(MAIN).toContain('foregroundListenerArmed = true;');
    expect(MAIN).toContain('foregroundListenerArmed = false;');
    expect(MAIN).toContain('calculatorInitiated ? "hello_detected" : "starting"');
  });

  it('accepts exactly-one-low only and never calls idle-high connected', () => {
    expect(AWARENESS_HEADER).toContain('struct ForegroundListenerStatus');
    expect(AWARENESS_SOURCE).toMatch(
      /if \(tipLow && ringLow\) return \{ "bus_unavailable", false \};/,
    );
    expect(AWARENESS_SOURCE).toMatch(
      /if \(tipLow \|\| ringLow\) return \{ "hello_candidate", true \};/,
    );
    expect(AWARENESS_SOURCE).toContain('return { "armed_unknown_idle", false };');
    expect(AWARENESS_SOURCE).toContain('return { "unknown", "unknown_idle" };');
  });

  it('keeps foreground listening behind both firmware safety gates', () => {
    expect(MAIN).toMatch(
      /const bool listenerAvailable = TI_TRANSMIT_ENABLED[\s\S]*?FOREGROUND_LISTENER_ENABLED[\s\S]*?syncWorkspace != nullptr;/,
    );
    expect(CONFIG_GENERATOR).toContain(
      '#define FOREGROUND_LISTENER_ENABLED ${link.foreground_listener === false ? 0 : 1}',
    );
    expect(CONFIG_EXAMPLE).toContain('transmit_enabled: false');
    expect(CONFIG_EXAMPLE).toContain('foreground_listener: true');
  });

  it('reports listener readiness, initiation provenance, verification, and safety', () => {
    for (const field of [
      'foreground_listener_enabled',
      'foreground_listener_state',
      'last_initiator',
      'calculator_initiated_sync_count',
      'peer_verified_this_session',
      'direction',
      'safe_to_unplug',
    ]) {
      expect(MAIN).toContain(`ti["${field}"]`);
    }
    expect(MAIN).toContain('calculatorInitiated ? "calculator" : "relay"');
  });

  it('keeps proactive auto-sync as a separate Silent Link compatibility path', () => {
    expect(MAIN).toMatch(
      /if \(AUTO_SYNC_ENABLED[\s\S]*?queueTiJob\(TiJob::SilentSync\)/,
    );
    expect(MAIN).not.toMatch(
      /if \(AUTO_SYNC_ENABLED[\s\S]{0,240}?queueTiJob\(TiJob::ForegroundSync\)/,
    );
  });
});
