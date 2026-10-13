#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const firmware = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(tmpdir(), 'schoolcalc-wire-native-test');
const compile = spawnSync(process.env.CXX || 'c++', [
  '-std=c++17', '-Wall', '-Wextra', '-Werror',
  '-I', path.join(firmware, 'src'),
  path.join(firmware, 'src', 'SchoolCalcBase64.cpp'),
  path.join(firmware, 'src', 'SchoolCalcWire.cpp'),
  path.join(firmware, 'src', 'SchoolCalcForegroundWire.cpp'),
  path.join(firmware, 'src', 'SchoolCalcForegroundSession.cpp'),
  path.join(firmware, 'src', 'SchoolCalcInput.cpp'),
  path.join(firmware, 'src', 'SchoolCalcDiagnostics.cpp'),
  path.join(firmware, 'src', 'SchoolCalcTransportAwareness.cpp'),
  path.join(firmware, 'src', 'SchoolCalcRelaySession.cpp'),
  path.join(firmware, 'test', 'native', 'test_schoolcalc_wire.cpp'),
  path.join(firmware, 'test', 'native', 'test_schoolcalc_foreground_wire.cpp'),
  path.join(firmware, 'test', 'native', 'test_schoolcalc_foreground_session.cpp'),
  path.join(firmware, 'test', 'native', 'test_schoolcalc_input.cpp'),
  path.join(firmware, 'test', 'native', 'test_schoolcalc_diagnostics.cpp'),
  path.join(firmware, 'test', 'native', 'test_schoolcalc_transport_awareness.cpp'),
  path.join(firmware, 'test', 'native', 'test_schoolcalc_relay_session.cpp'),
  '-o', output,
], { stdio: 'inherit' });
if (compile.status !== 0) process.exit(compile.status ?? 1);
const test = spawnSync(output, [], { stdio: 'inherit' });
if (test.status !== 0) process.exit(test.status ?? 1);
const configTest = spawnSync(process.execPath, [
  '--test', path.join(firmware, 'tools', 'gen-config.test.mjs'),
], { stdio: 'inherit' });
process.exit(configTest.status ?? 1);
