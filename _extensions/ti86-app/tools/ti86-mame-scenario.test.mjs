import { describe, expect, it } from 'vitest';
import {
  TI86_FRAMEBUFFER_BYTES,
  createTi86MameGraphLinkScenarioScript,
  hasSchoolCalcHeader,
  createTi86MameScenarioScript,
  normalizeTi86MameScenario,
  parseTi86MameScenarioOutput,
  renderTi86FramebufferAscii,
} from './lib/ti86-mame-scenario.mjs';

const SCENARIO = {
  id: 'catalog-does-not-bounce',
  steps: [
    { key: 'F2', capture: 'catalog', expect_different_from: 'boot' },
    { key: 'EXIT', capture: 'home' },
  ],
};

describe('TI-86 MAME scenario harness', () => {
  it('normalizes F keys, arrows, 2nd, enter, exit, clear, and on', () => {
    const scenario = normalizeTi86MameScenario({
      id: 'all-keys',
      steps: ['F1', 'F2', 'F3', 'F4', 'F5', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'SECOND', 'ENTER', 'EXIT', 'CLEAR', 'ON']
        .map((key, index) => ({ key, capture: `key-${index}` })),
    });
    expect(scenario.steps.map(({ key }) => key)).toEqual([
      'F1', 'F2', 'F3', 'F4', 'F5', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'SECOND', 'ENTER', 'EXIT', 'CLEAR', 'ON',
    ]);
  });

  it('preserves normalized runtime waits when generators normalize again', () => {
    const first = normalizeTi86MameScenario({
      id: 'long-boot',
      boot_settle_frames: 1200,
      settle_frames: 60,
      steps: [{ key: 'ENTER', capture: 'home', hold_frames: 12, settle_frames: 180, expect_text: 'HOME' }],
    });
    const second = normalizeTi86MameScenario(first);
    expect(second.bootSettleFrames).toBe(1200);
    expect(second.steps[0]).toMatchObject({ holdFrames: 12, settleFrames: 180, expectText: ['HOME'] });
  });

  it('generates an exact-byte script with scheduled key presses and full framebuffer captures', () => {
    const script = createTi86MameScenarioScript({
      code: Buffer.from([0x3E, 0x01, 0xC9]),
      scenario: SCENARIO,
      readyFile: '/tmp/ready',
    });
    expect(script).toContain('local code = {\n  62, 1, 201\n}');
    expect(script).toContain("port=':BIT3', mask=0x40");
    expect(script).toContain(`local FRAME_BYTES = ${TI86_FRAMEBUFFER_BYTES}`);
    expect(script).toContain("capture('boot')");
    expect(script).toContain('SCHOOLCALC_SCENARIO_');
    expect(script).not.toContain('cpu.debug');
  });

  it('uses TI-OS PRGM launch after the virtual Graph Link release is ready', () => {
    const script = createTi86MameGraphLinkScenarioScript({
      code: Buffer.from([0xC9]),
      readyFile: '/tmp/schoolcalc-release-ready',
      scenario: { id: 'launch', steps: [{ key: 'F2' }] },
    });
    expect(script).toContain("key='PRGM'");
    expect(script).toContain("key='F1'");
    expect(script).toContain("key='ENTER'");
    expect(script).toContain("local READY_FILE = '/tmp/schoolcalc-release-ready'");
    expect(script).not.toContain('pc.value=ORIGIN');
  });

  it('chooses a requested installed program from the real TI-OS PROGRAM page', () => {
    const script = createTi86MameGraphLinkScenarioScript({
      code: Buffer.from([0xC9]),
      readyFile: '/tmp/schoolcalc-release-ready',
      launchProgram: 'SCHLCALC',
      programNames: ['ASCHL', 'SCCAT', 'SCHLCALC'],
      scenario: { id: 'launch-shell', steps: [{ key: 'F2' }] },
    });
    expect(script).toContain("key='F3'");
  });

  it('detects the exact Catalog-to-Home bounce reported on hardware', () => {
    const home = Buffer.alloc(TI86_FRAMEBUFFER_BYTES, 0x11).toString('hex').toUpperCase();
    const other = Buffer.alloc(TI86_FRAMEBUFFER_BYTES, 0x22).toString('hex').toUpperCase();
    const output = [
      `SCHOOLCALC_FRAME id=catalog-does-not-bounce capture=boot pc=D748 pixels=${home}`,
      `SCHOOLCALC_FRAME id=catalog-does-not-bounce capture=catalog pc=D760 pixels=${home}`,
      `SCHOOLCALC_FRAME id=catalog-does-not-bounce capture=home pc=D770 pixels=${other}`,
      'SCHOOLCALC_SCENARIO_PASS id=catalog-does-not-bounce detail=steps-complete',
    ].join('\n');
    expect(() => parseTi86MameScenarioOutput(output, SCENARIO)).toThrow(/left the screen unchanged|bounced/);
  });

  it('normalizes an explicit negative text oracle for a deliberate app exit', () => {
    const scenario = normalizeTi86MameScenario({
      id: 'quit', steps: [{ key: 'EXIT', capture: 'ti-os', expect_not_text: 'SCHOOLCALC' }],
    });
    expect(scenario.steps[0].expectNotText).toEqual(['SCHOOLCALC']);
  });

  it('recognizes the shared inverse SchoolCalc header and rejects a TI-OS screen', () => {
    const shell = Buffer.alloc(TI86_FRAMEBUFFER_BYTES, 0);
    shell.fill(0xFF, 0, 16 * 8);
    expect(hasSchoolCalcHeader(shell)).toBe(true);
    expect(hasSchoolCalcHeader(Buffer.alloc(TI86_FRAMEBUFFER_BYTES))).toBe(false);
  });

  it('renders all 128 × 64 LCD pixels as deterministic ASCII', () => {
    const pixels = Buffer.alloc(TI86_FRAMEBUFFER_BYTES);
    pixels[0] = 0x80;
    const ascii = renderTi86FramebufferAscii(pixels).split('\n');
    expect(ascii).toHaveLength(65);
    expect(ascii[0]).toHaveLength(128);
    expect(ascii[0].startsWith('█...')).toBe(true);
    expect(ascii[1]).toBe('.'.repeat(128));
  });
});
