#!/usr/bin/env node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const firmware = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), 'daylight-mat-test-'));
try {
  const binary = path.join(temp, 'detector-test');
  execFileSync(process.env.CXX || 'g++', [
    '-std=c++11', '-Wall', '-Wextra', '-Werror', '-fsanitize=address,undefined',
    '-fno-omit-frame-pointer', '-I', path.join(firmware, 'include'),
    path.join(firmware, 'test/detector.cpp'), '-o', binary,
  ], { stdio: 'inherit' });
  execFileSync(binary, [], { stdio: 'inherit' });
} finally {
  rmSync(temp, { recursive: true, force: true });
}
