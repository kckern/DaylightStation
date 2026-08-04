import { describe, expect, it } from 'vitest';
import {
  Ti86NativeToolMapper,
  TI86_NATIVE_LAUNCH,
  TI86_NATIVE_MAX_EXPRESSION_DEPTH,
  TI86_NATIVE_MAX_PAYLOAD_BYTES,
  TI86_NATIVE_REAL_MAX_EXPONENT,
  TI86_NATIVE_REAL_MIN_EXPONENT,
  TI86_NATIVE_OPERATION,
  TI86_NATIVE_PLAN_SCHEMA,
  TI86_NATIVE_SNAPSHOT_RESOURCE,
  decodeTi86NativePlan,
  decodeTi86Real,
  encodeTi86Real,
  tokenizeTi86NativeExpression,
  validateTi86NativeExpressionTokens,
} from './Ti86NativeToolMapper.mjs';
import { Ti86SchoolCalcCodec, decodeTi86Envelope } from './Ti86SchoolCalcCodec.mjs';

describe('Ti86NativeToolMapper', () => {
  it('encodes TI-86 ten-byte reals with exact sign, exponent, and BCD digits', () => {
    expect(encodeTi86Real(0).toString('hex')).toBe('0000fc00000000000000');
    expect(encodeTi86Real(1).toString('hex')).toBe('0000fc10000000000000');
    expect(encodeTi86Real(-10).toString('hex')).toBe('8001fc10000000000000');
    expect(encodeTi86Real(0.5).toString('hex')).toBe('00fffb50000000000000');
    expect(encodeTi86Real(123.456).toString('hex')).toBe('0002fc12345600000000');
    for (const value of [-10, -0.125, 0, 0.5, 123.456, 1e40]) {
      expect(decodeTi86Real(encodeTi86Real(value))).toBeCloseTo(value, 12);
    }
    expect(TI86_NATIVE_REAL_MIN_EXPONENT).toBe(-308);
    expect(TI86_NATIVE_REAL_MAX_EXPONENT).toBe(307);
    expect(decodeTi86Real(encodeTi86Real(1e307))).toBe(1e307);
    expect(() => encodeTi86Real(1e308)).toThrow(/exponent/);
    const belowRange = Buffer.from('00cbfa10000000000000', 'hex');
    const aboveRange = Buffer.from('0034fd10000000000000', 'hex');
    expect(() => decodeTi86Real(belowRange)).toThrow(/reviewed adapter range/);
    expect(() => decodeTi86Real(aboveRange)).toThrow(/reviewed adapter range/);
    expect(() => encodeTi86Real(Infinity)).toThrow(/finite/);
  });

  it('tokenizes only the reviewed arithmetic grammar', () => {
    expect(tokenizeTi86NativeExpression('2*x+1').toString('hex'))
      .toBe('4432007032017860443100');
    expect(tokenizeTi86NativeExpression('sin(x)').toString('hex'))
      .toBe('aa1032017811');
    expect(tokenizeTi86NativeExpression('-x^2').toString('hex'))
      .toBe('a0320178f0443200');
    expect(tokenizeTi86NativeExpression('RATE=2', {
      variables: ['RATE'], allowEquation: true,
    }).toString('hex')).toBe('36524154453f443200');
    for (const expression of ['Asm(PROG)', 'x:Disp 1', 'y+1', '2x', 'x=2']) {
      expect(() => tokenizeTi86NativeExpression(expression)).toThrow();
    }
    const tooDeep = `${'('.repeat(TI86_NATIVE_MAX_EXPRESSION_DEPTH + 1)}x${')'.repeat(TI86_NATIVE_MAX_EXPRESSION_DEPTH + 1)}`;
    expect(() => tokenizeTi86NativeExpression(tooDeep)).toThrow(/nesting depth/);
    expect(() => validateTi86NativeExpressionTokens(Buffer.from([0xEF]))).toThrow(/unsupported byte/);
    expect(() => validateTi86NativeExpressionTokens(
      tokenizeTi86NativeExpression('x=2', { allowEquation: true }),
    )).toThrow(/do not allow/);
  });

  it('maps logical graph slots and window numbers without authored TI names', () => {
    const plan = new Ti86NativeToolMapper().map({
      type: 'tool', capability: 'graph@1',
      config: {
        equations: [
          { slot: 'secondary', expression: '2*x+1' },
          { slot: 'primary', expression: 'sin(x)' },
        ],
        window: { xMin: -10, xMax: 10, yMin: -5, yMax: 5 },
      },
    });
    expect(plan).toMatchObject({
      schema: TI86_NATIVE_PLAN_SCHEMA,
      version: 1,
      operation: TI86_NATIVE_OPERATION.graph,
      launch: TI86_NATIVE_LAUNCH.graph,
      snapshot: [TI86_NATIVE_SNAPSHOT_RESOURCE.functionGraphDatabase],
    });
    expect(plan.payload[0]).toBe(2);
    expect(plan.payload[1]).toBe(2);
    expect(plan.payload.includes(0x0F)).toBe(true);
    expect(plan).not.toHaveProperty('programName');
  });

  it('maps every portable capability into a bounded, closed plan', () => {
    const mapper = new Ti86NativeToolMapper({
      programs: {
        'reviewed-helper': {
          programName: 'DSHELP',
          argumentKinds: ['number', 'boolean', 'string'],
          snapshotResources: ['functionGraphDatabase'],
        },
      },
    });
    const modules = [
      { capability: 'calculator@1', config: { expression: '2+2' } },
      { capability: 'graph@1', config: { equations: [{ slot: 'primary', expression: 'x' }] } },
      { capability: 'table@1', config: { expressions: ['x^2'], start: 0, step: 0.5 } },
      { capability: 'solver@1', config: { equation: 'x^2=4', variable: 'x', initial: 1 } },
      { capability: 'matrix@1', config: { matrices: [{ id: 'a', values: [[1, 2], [3, 4]] }] } },
      { capability: 'equation-editor@1', config: { equations: ['x+1'] } },
      { capability: 'native-program@1', config: { toolId: 'reviewed-helper', args: [3, true, 'ok'] } },
    ];
    const plans = modules.map((module) => mapper.map({ type: 'tool', ...module }));
    expect(plans.map((plan) => plan.operation)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(plans.every((plan) => Buffer.isBuffer(plan.payload) && plan.payload.length < 1024)).toBe(true);
    expect(plans[6].payload.subarray(1, 7).toString('ascii')).toBe('DSHELP');
    expect(plans[6].snapshot).toEqual([
      TI86_NATIVE_SNAPSHOT_RESOURCE.functionGraphDatabase,
      TI86_NATIVE_SNAPSHOT_RESOURCE.nativeProgramWorkspace,
    ]);
    const decoded = plans.map((plan) => mapper.decode(plan));
    expect(decoded.map((plan) => plan.capability)).toEqual([
      'calculator', 'graph', 'table', 'solver', 'matrix', 'equationEditor', 'nativeProgram',
    ]);
    expect(decoded[1].decoded.window).toBeNull();
    expect(decoded[2].decoded).toMatchObject({ start: 0, step: 0.5 });
    expect(decoded[3].decoded).toMatchObject({ variable: 'x', initial: 1 });
    expect(decoded[4].decoded.matrices[0].values).toEqual([[1, 2], [3, 4]]);
    expect(decoded[6].decoded).toMatchObject({
      toolId: 'reviewed-helper', programName: 'DSHELP', args: [3, true, 'ok'],
    });
  });

  it('decodes every payload shape and rejects operation, launch, snapshot, token, real, and framing tampering', () => {
    const mapper = new Ti86NativeToolMapper();
    const graph = mapper.map({
      type: 'tool', capability: 'graph@1',
      config: {
        equations: [{ slot: 'primary', expression: 'x+1' }],
        window: { xMin: -10, xMax: 10, yMin: -5, yMax: 5 },
      },
    });
    expect(decodeTi86NativePlan(graph).decoded).toMatchObject({
      equations: [{ slot: 1 }],
      window: { xMin: -10, xMax: 10, yMin: -5, yMax: 5 },
    });
    expect(() => decodeTi86NativePlan({ ...graph, launch: TI86_NATIVE_LAUNCH.home }))
      .toThrow(/launch target/);
    expect(() => decodeTi86NativePlan({ ...graph, snapshot: [TI86_NATIVE_SNAPSHOT_RESOURCE.homeEntry] }))
      .toThrow(/mutation contract/);
    expect(() => decodeTi86NativePlan({ ...graph, snapshot: [2, 2] }))
      .toThrow(/noncanonical/);
    expect(() => decodeTi86NativePlan({ ...graph, unexpected: true }))
      .toThrow(/unsupported field/);

    const injected = Buffer.from(graph.payload);
    injected[3] = 0xEF;
    expect(() => decodeTi86NativePlan({ ...graph, payload: injected })).toThrow(/unsupported byte/);
    expect(() => decodeTi86NativePlan({ ...graph, payload: graph.payload.subarray(0, -1) }))
      .toThrow(/truncated/);
    expect(() => decodeTi86NativePlan({ ...graph, payload: Buffer.concat([graph.payload, Buffer.from([0])]) }))
      .toThrow(/trailing/);
    expect(() => decodeTi86NativePlan({ ...graph, payload: Buffer.alloc(TI86_NATIVE_MAX_PAYLOAD_BYTES + 1) }))
      .toThrow(/at most/);

    const table = mapper.map({
      type: 'tool', capability: 'table@1',
      config: { expressions: ['x'], start: 0, step: 1 },
    });
    const noncanonicalReal = Buffer.from(table.payload);
    noncanonicalReal[noncanonicalReal.length - 10] = 0x01;
    expect(() => decodeTi86NativePlan({ ...table, payload: noncanonicalReal }))
      .toThrow(/real bytes|canonical/);
  });

  it('requires the compiler and runtime to share one unambiguous native-program allowlist', () => {
    const programs = {
      'reviewed-helper': {
        programName: 'DSHELP',
        argumentKinds: ['number', 'boolean', 'string'],
        snapshotResources: ['functionGraphDatabase'],
      },
    };
    const mapper = new Ti86NativeToolMapper({ programs });
    const plan = mapper.map({
      type: 'tool', capability: 'native-program@1',
      config: { toolId: 'reviewed-helper', args: [2, false, 'safe'] },
    });
    expect(() => decodeTi86NativePlan(plan)).toThrow(/runtime-allowlisted/);
    expect(decodeTi86NativePlan(plan, { programs }).decoded.args).toEqual([2, false, 'safe']);

    const renamed = Buffer.from(plan.payload);
    Buffer.from('DSHACK', 'ascii').copy(renamed, 1);
    expect(() => decodeTi86NativePlan({ ...plan, payload: renamed }, { programs }))
      .toThrow(/runtime-allowlisted/);
    expect(() => new Ti86NativeToolMapper({
      programs: {
        first: { programName: 'DSSAME' },
        second: { programName: 'DSSAME' },
      },
    })).toThrow(/more than once/);
  });

  it('fails closed on unbounded mappings, executable fields, and unallowlisted programs', () => {
    const mapper = new Ti86NativeToolMapper();
    expect(() => mapper.map({
      type: 'tool', capability: 'graph@1',
      config: { equations: [{ slot: 'y1', expression: 'x' }] },
    })).toThrow(/logical equation slot/);
    expect(() => mapper.map({
      type: 'tool', capability: 'graph@1',
      config: { equations: [{ slot: 'primary', expression: 'x' }], source: 'Asm(PROG)' },
    })).toThrow(/unsupported field 'source'/);
    expect(() => mapper.map({
      type: 'tool', capability: 'native-program@1',
      config: { toolId: 'reviewed-helper', args: [] },
    })).toThrow(/not allowlisted/);
    expect(() => new Ti86NativeToolMapper({
      programs: { bad: { programName: 'USER NAME' } },
    })).toThrow(/installed program name/);
  });

  it('projects the native plan into SCP1 and omits the portable config tree', () => {
    const codec = new Ti86SchoolCalcCodec();
    const bundle = {
      schema: 'school.learning-lesson/v1',
      address: 'main/quant/modeling/linear/graph',
      context: {
        catalog: { catalogId: 'main', title: 'Main' },
        subject: { subjectId: 'quant', title: 'Quantitative studies' },
        course: { courseId: 'modeling', title: 'Modeling' },
        unit: { unitId: 'linear', title: 'Linear models' },
      },
      lesson: {
        lessonId: 'graph', title: 'Explore a model', objectives: [],
        modules: [{
          moduleId: 'plot', type: 'tool', title: 'Open graph', capability: 'graph@1',
          config: {
            equations: [{ slot: 'primary', expression: '2*x+1' }],
            window: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 },
          },
        }],
      },
      capabilities: ['graph@1'],
    };
    const artifact = codec.compile(bundle, {
      capabilities: ['graph@1'], limits: { maxArtifactBytes: 12_288 },
    });
    const module = decodeTi86Envelope(artifact.bytes, 'SCP1').lesson.modules[0];
    expect(module.capability).toBe('graph@1');
    expect(module.nativePlan).toMatchObject({ operation: 2, launch: 2, snapshot: [2] });
    expect(Buffer.isBuffer(module.nativePlan.payload)).toBe(true);
    expect(module).not.toHaveProperty('config');
  });
});
