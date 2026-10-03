import { describe, it, expect } from 'vitest';
import { extractRoutines, matchRoutines, routinesTargeting, parseLoadQuery, validateRoutineImport, ROUTINE_IMPORT_LIMITS } from './routineCatalog.mjs';

// Shapes copied from the household's Home Assistant config (_includes/):
// rest_commands are a merged map, scripts are named by file, automations a list.
const restCommands = {
  device_livingroom_tv: { url: 'http://daylight-station:3111/api/v1/device/livingroom-tv/{{ action }}', method: 'GET' },
  device_office_tv: { url: 'http://daylight-station:3111/api/v1/device/office-tv/{{ action }}' },
  office_program: { url: 'http://daylight-station:3111/api/v1/device/office-tv/load?queue=office-program' },
  hymn: { url: 'http://daylight-station:3111/api/v1/device/livingroom-tv/load?hymn={{ hymn_num }}' },
  tv_off: { url: 'http://daylight-station:3111/api/v1/device/livingroom-tv/off' },
  doorbell: { url: 'http://daylight-station:3111/api/v1/camera/doorbell/event' },
};
const scripts = {
  livingroom_tv_sequence: {
    alias: 'Living Room TV Sequence',
    fields: { query: { default: 'queue=music-queue&shader=dark&volume=10&shuffle=1' } },
    sequence: [
      { service: 'script.kitchen_desk_nightlight_color', data: { color: 'white' } },
      { service: 'rest_command.device_livingroom_tv', data: { action: "load?{{ query | default('queue=music-queue&shader=dark&volume=10&shuffle=1') }}" } },
    ],
  },
  office_tv_on: {
    alias: 'Office TV On',
    sequence: [{ service: 'rest_command.device_office_tv', data: { action: 'audio/IEC958' } }],
  },
};
const automations = [
  { alias: 'Kitchen Button 1: Morning Program', id: 'kitchen_button_1', actions: [{ action: 'script.livingroom_tv_sequence', data: { query: 'queue=morning-program' } }] },
  { alias: 'Kitchen Button 4: Slow TV', id: 'kitchen_button_4', actions: [{ action: 'script.livingroom_tv_sequence', data: { query: 'queue=slow-tv&shader=minimal&volume=10&shuffle=1' } }] },
  { alias: 'Office Morning Program: Auto-start', id: 'office_morning_program_auto_start', actions: [
    { service: 'rest_command.office_program' }, { service: 'input_boolean.turn_on', target: { entity_id: 'input_boolean.x' } },
  ] },
  { alias: 'Christmas music', id: 'xmas', action: [{ choose: [{ sequence: [{ service: 'script.turn_on', target: { entity_id: 'script.livingroom_tv_sequence' }, data: { variables: { query: 'queue=christmas' } } }] }] }] },
  { alias: 'Lights only', id: 'lights', actions: [{ service: 'light.turn_on' }] },
];

describe('parseLoadQuery', () => {
  it('reads params; template values stay as wildcards', () => {
    expect(parseLoadQuery('queue=slow-tv&shuffle=1')).toEqual({ queue: 'slow-tv', shuffle: '1' });
    expect(parseLoadQuery('hymn={{ hymn_num }}')).toEqual({ hymn: '*' });
    expect(parseLoadQuery('{{ query }}')).toBeNull();
  });
});

describe('extractRoutines', () => {
  const routines = extractRoutines({ restCommands, scripts, automations });
  const byId = Object.fromEntries(routines.map((r) => [r.id, r]));

  it('follows automation → script → rest command to the screen and the content it loads', () => {
    expect(byId['automation:kitchen_button_1']).toMatchObject({
      name: 'Kitchen Button 1: Morning Program', kind: 'automation', source: 'home-assistant',
      targets: [{ deviceId: 'fleet:livingroom-tv', screenId: 'livingroom-tv', query: 'queue=morning-program' }],
      via: ['script:livingroom_tv_sequence', 'rest_command:device_livingroom_tv'],
    });
    expect(byId['automation:kitchen_button_4'].targets[0].query).toBe('queue=slow-tv&shader=minimal&volume=10&shuffle=1');
  });

  it('a fixed load URL is a target; script.turn_on with variables is followed', () => {
    expect(byId['automation:office_morning_program_auto_start'].targets).toEqual([
      { deviceId: 'fleet:office-tv', screenId: 'office-tv', query: 'queue=office-program' },
    ]);
    expect(byId['automation:xmas'].targets[0]).toMatchObject({ deviceId: 'fleet:livingroom-tv', query: 'queue=christmas' });
  });

  it('a script that loads is itself a routine, with its default query', () => {
    expect(byId['script:livingroom_tv_sequence']).toMatchObject({
      kind: 'script', name: 'Living Room TV Sequence',
      targets: [{ deviceId: 'fleet:livingroom-tv', query: 'queue=music-queue&shader=dark&volume=10&shuffle=1' }],
    });
  });

  it('a loading rest command nobody calls is listed too, so no load path is invisible', () => {
    expect(byId['rest_command:hymn']).toMatchObject({ kind: 'command', targets: [{ deviceId: 'fleet:livingroom-tv', query: 'hymn={{ hymn_num }}' }] });
    // ...but one an automation/script already calls is not repeated.
    expect(byId['rest_command:office_program']).toBeUndefined();
  });

  it('non-load device calls (off, audio) and unrelated automations are not routines', () => {
    expect(byId['script:office_tv_on']).toBeUndefined();
    expect(byId['automation:lights']).toBeUndefined();
    expect(byId['rest_command:tv_off']).toBeUndefined();
  });

  it('survives cycles and junk', () => {
    const loop = { a: { alias: 'A', sequence: [{ service: 'script.b' }] }, b: { alias: 'B', sequence: [{ service: 'script.a' }] } };
    expect(extractRoutines({ restCommands: null, scripts: loop, automations: [null, 7, { id: 'x' }] })).toEqual([]);
  });
});

describe('matchRoutines / routinesTargeting', () => {
  const routines = extractRoutines({ restCommands, scripts, automations });
  it('names the routine behind a load by screen + exact params, preferring automations', () => {
    const [best] = matchRoutines(routines, 'livingroom-tv', { queue: 'slow-tv', shader: 'minimal', volume: '10', shuffle: '1' });
    expect(best.id).toBe('automation:kitchen_button_4');
    expect(matchRoutines(routines, 'livingroom-tv', { hymn: '113' })[0].id).toBe('rest_command:hymn');
    expect(matchRoutines(routines, 'office-tv', { queue: 'nothing-like-it' })).toEqual([]);
  });
  it('lists routines that target a screen by stable id', () => {
    expect(routinesTargeting(routines, 'fleet:office-tv').map((r) => r.id)).toEqual(['automation:office_morning_program_auto_start']);
    expect(routinesTargeting(routines, 'fleet:livingroom-tv').length).toBeGreaterThanOrEqual(4);
  });
});

describe('validateRoutineImport', () => {
  const ok = { id: 'automation:a', name: 'A', kind: 'automation', targets: [{ deviceId: 'fleet:tv', screenId: 'tv', query: 'queue=x' }], via: [] };
  it('accepts well-formed routines and bounds everything', () => {
    expect(validateRoutineImport([ok])).toEqual([]);
    expect(validateRoutineImport('nope')).toEqual(['routines must be an array']);
    expect(validateRoutineImport(Array(ROUTINE_IMPORT_LIMITS.maxRoutines + 1).fill(ok))[0]).toMatch(/at most/);
    expect(validateRoutineImport([{ ...ok, kind: 'virus' }])[0]).toMatch(/kind/);
    expect(validateRoutineImport([{ ...ok, via: ['x'.repeat(200)] }])[0]).toMatch(/via/);
  });
});

describe('automation variables', () => {
  it('honours automation-level variables passed down the chain', () => {
    const routines = extractRoutines({
      restCommands: { tv: { url: 'http://h/api/v1/device/livingroom-tv/{{ action }}' } },
      scripts: { seq: { alias: 'Seq', sequence: [{ service: 'rest_command.tv', data: { action: 'load?{{ query }}' } }] } },
      automations: [{ id: 'v', alias: 'V', variables: { q: 'queue=evening' }, actions: [{ action: 'script.seq', data: { query: '{{ q }}' } }] }],
    });
    expect(routines.find((r) => r.id === 'automation:v').targets[0].query).toBe('queue=evening');
  });
});
