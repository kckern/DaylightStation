import { it, expect, vi } from 'vitest';
import { runWorkCli, main } from './work.cli.mjs';
const setup = () => {
  const output = [],
    runtime = {
      context: {
        execute: vi.fn(async () => ({
          items: [],
          coverage: {
            complete: false
          }
        }))
      },
      backfill: {
        prepare: vi.fn(async () => ({
          manifestPath: '/private/job.manifest.json'
        })),
        preview: vi.fn(async () => ({
          artifactPath: '/private/job.artifact.json',
          report: {
            complete: true
          }
        })),
        apply: vi.fn(async () => ({
          applied: true
        }))
      }
    };
  return {
    output,
    runtime,
    stdout: {
      write: text => output.push(text)
    },
    clock: () => Date.parse('2026-11-17T18:00Z')
  };
};
it('routes explicit inspect/prepare/preview/apply inputs without starting live maintenance', async () => {
  const h = setup();
  await runWorkCli({
    ...h,
    argv: ['inspect', '--username', 'sample']
  });
  expect(h.runtime.context.execute).toHaveBeenCalledWith({
    username: 'sample',
    asOf: h.clock()
  });
  await runWorkCli({
    ...h,
    argv: ['backfill', 'prepare', '--username', 'sample', '--days', '90', '--as-of', '2026-11-17T18:00:00Z', '--output-dir', '/private']
  });
  expect(h.runtime.backfill.prepare).toHaveBeenCalledWith({
    username: 'sample',
    days: 90,
    asOf: h.clock(),
    outputDir: '/private'
  });
  await runWorkCli({
    ...h,
    argv: ['backfill', 'preview', '--manifest', '/private/job.manifest.json', '--usage-dir', '/private/usage']
  });
  expect(h.runtime.backfill.preview).toHaveBeenCalledWith({
    manifestPath: '/private/job.manifest.json',
    usageDir: '/private/usage'
  });
  await runWorkCli({
    ...h,
    argv: ['backfill', 'apply', '--manifest', '/private/job.manifest.json', '--artifact', '/private/job.artifact.json']
  });
  expect(h.runtime.backfill.apply).toHaveBeenCalledWith({
    manifestPath: '/private/job.manifest.json',
    artifactPath: '/private/job.artifact.json'
  });
});
it('rejects unsupported commands, extra authority flags, duplicate options and timezone-less instants before any port call', async () => {
  const h = setup();
  for (const argv of [['sync'], ['backfill', 'apply', '--force'], ['inspect', '--username', 'sample', '--writer-host', 'other'], ['inspect', '--username', 'sample', '--username', 'other'], ['backfill', 'prepare', '--username', 'sample', '--days', '91', '--as-of', '2026-11-17T18:00:00Z', '--output-dir', '/private'], ['backfill', 'prepare', '--username', 'sample', '--days', '90', '--as-of', '2026-11-17T18:00:00', '--output-dir', '/private']]) await expect(runWorkCli({
    ...h,
    argv
  })).rejects.toThrow();
  expect(h.runtime.context.execute).not.toHaveBeenCalled();
  expect(h.runtime.backfill.apply).not.toHaveBeenCalled();
  expect(h.runtime.backfill.prepare).not.toHaveBeenCalled();
});
it('prints help without initializing configuration, credentials or runtime', async () => {
  const dependenciesFactory = vi.fn(),
    output = [];
  expect(await main(['--help'], {
    dependenciesFactory,
    stdout: {
      write: text => output.push(text)
    }
  })).toBe(0);
  expect(dependenciesFactory).not.toHaveBeenCalled();
  expect(output.join('')).toContain('90');
});
