// The Phase 0 spike as a script: ordered steps with stable ids, plus the pure
// decisions around it (which key does what, what a director message asks for,
// which model the later tests run on).

import { POSE_FPS_GATE } from './poseMetrics.js';

export const MODEL_A = 'full';
export const MODEL_B = 'lite';

const wait = (id, title, text, extra = {}) => ({ id, kind: 'wait', title, text, gesture: true, panel: 'info', load: false, model: null, ...extra });
const timed = (id, durationS, title, text, extra = {}) => ({
  id, kind: 'timed', durationS, leadS: 3, title, text, gesture: false, panel: 'aim', load: true, model: 'auto', settleS: 0, ...extra,
});

function poseSteps(model) {
  return [
    timed(`t1.${model}.baseline`, 60, `Pose speed: ${model} model`, 'Stand on the mat facing the camera. Wave your arms slowly the whole time.',
      { test: 't1', panel: 'pose', model, load: false }),
    timed(`t1.${model}.load`, 60, `Pose speed: ${model} model + game load`, 'Same again. Keep waving your arms. The screen is drawing a fake game.',
      { test: 't1', panel: 'pose', model, load: true }),
  ];
}

function aimSteps(subject) {
  const who = subject === 'kid' ? 'Kid' : 'Adult';
  const s = (suffix, durationS, title, text, extra = {}) => timed(`t2.${subject}.${suffix}`, durationS, `${who}: ${title}`, text, { test: 't2', subject, skeleton: true, ...extra });
  return [
    s('sweep', 30, 'sweep', 'Arms out in front at chest height, hands together. Sweep slowly from far LEFT to far RIGHT and back. Pointing at the screen is the middle.'),
    s('hold_left', 10, 'hold LEFT', 'Point both arms out to your far LEFT, chest height, and FREEZE.', { leadS: 4, settleS: 2 }),
    s('hold_center', 10, 'hold CENTER', 'Point both arms straight at the screen, chest height, and FREEZE.', { leadS: 4, settleS: 2 }),
    s('hold_right', 10, 'hold RIGHT', 'Point both arms out to your far RIGHT, chest height, and FREEZE.', { leadS: 4, settleS: 2 }),
    s('twist', 15, 'twist', 'Keep both arms pointing straight out from your chest. Slowly twist your shoulders a little LEFT and RIGHT, arms moving with your chest. The marker should stay in the middle.', { leadS: 4, settleS: 2 }),
    s('one_arm_left', 20, 'LEFT arm only', 'Right arm down at your side. Sweep your LEFT arm slowly left and right.', { leadS: 4 }),
    s('one_arm_right', 20, 'RIGHT arm only', 'Left arm down at your side. Sweep your RIGHT arm slowly left and right.', { leadS: 4 }),
    s('arms_low', 20, 'arms low', 'Both arms pointing forward at WAIST height. Sweep them a little left and right.', { leadS: 4 }),
    s('turn_away', 5, 'turn away', 'Turn your back to the camera, or step half out of view.', { leadS: 4 }),
  ];
}

/** The full script. Step ids are stable and appear on every log event. */
export function buildScript() {
  return [
    wait('framing', 'Framing check', 'Stand on the mat facing the camera, arms relaxed. Your head and shoulders should be inside the picture.', { panel: 'framing', skeleton: true, gesture: false }),
    wait('t1.intro', 'Test 1 of 3: pose speed', 'Four one-minute runs. Just keep waving your arms. Nothing to press until it finishes.', { test: 't1' }),
    ...poseSteps(MODEL_A),
    ...poseSteps(MODEL_B),
    wait('t2.adult.intro', 'Test 2 of 3: aiming (adult)', 'You aim with your arms, measured from your own chest. Hands out in front of your chest is the middle, at any height. Reach to your left or right to move the marker. Follow each prompt.', { test: 't2', subject: 'adult', model: 'auto', load: true }),
    ...aimSteps('adult'),
    wait('kid.intro', "Kid's turn", 'Swap places. Kid stands on the mat facing the camera, then continue.', { test: 't2', subject: 'kid', model: 'auto', load: true, skeleton: true }),
    ...aimSteps('kid'),
    wait('t3.intro', 'Test 3 of 3: the mat', 'Adult back on the mat. First a speed drill, then stepping while you aim.', { test: 't3', model: 'auto', load: true }),
    timed('t3.drill', 15, 'Step OFF, step ON, as fast as you can', 'Every time you step back ON counts as one shot. Go as fast as you can keep up.', { test: 't3', panel: 'mat', drill: true, leadS: 5 }),
    timed('t3.free', 30, 'Aim and fire', 'Point at a spot with your arms, then step off and on to fire. Move your aim between shots. Normal pace.', { test: 't3', panel: 'mat', skeleton: true, leadS: 5 }),
    wait('results', 'Done', 'Results are below and have been sent. You can leave this screen up.', { panel: 'results', gesture: false, model: 'auto', load: false }),
  ];
}

// The garage macropad binds digits 1-6 to OS actions (reload, taskbar, menu,
// alt+f4, restart kiosk, screenshot). They must never drive the script.
const OS_BOUND_KEYS = new Set(['1', '2', '3', '4', '5', '6']);
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'OS', 'Fn']);

/**
 * What a keydown does. Never 'next' for anything the OS or browser also acts on.
 * @returns {{ action: 'next'|'redo'|'ignored', reason: string }}
 */
export function classifyKey({ key = '', code = '', ctrlKey = false, altKey = false, metaKey = false, repeat = false } = {}) {
  if (repeat) return { action: 'ignored', reason: 'auto_repeat' };
  if (OS_BOUND_KEYS.has(key) || /^(Digit|Numpad)[1-6]$/.test(code)) return { action: 'ignored', reason: 'os_bound_digit' };
  if (MODIFIER_KEYS.has(key)) return { action: 'ignored', reason: 'modifier_key' };
  if (ctrlKey || altKey || metaKey) return { action: 'ignored', reason: 'modifier_combo' };
  if (/^F\d{1,2}$/.test(key)) return { action: 'ignored', reason: 'function_key' };
  if (key === 'Tab') return { action: 'ignored', reason: 'tab' };
  if (key === 'Escape' || key === 'Backspace') return { action: 'redo', reason: 'redo_key' };
  return { action: 'next', reason: 'key' };
}

/**
 * Read a director file. Returns null for anything unusable or already seen.
 * @returns {null|{ id: string, text: string|null, command: 'goto'|'restart_step'|null, step: string|null }}
 */
export function parseDirector(json, lastSeenId, stepIds = []) {
  if (!json || typeof json !== 'object' || json.id == null) return null;
  const id = String(json.id);
  if (id === String(lastSeenId ?? '')) return null;
  const text = typeof json.text === 'string' && json.text.trim() ? json.text.trim() : null;
  let command = null;
  let step = null;
  if (json.command === 'restart_step') command = 'restart_step';
  else if (json.command === 'goto' && typeof json.step === 'string' && stepIds.includes(json.step)) {
    command = 'goto';
    step = json.step;
  }
  const rejected = json.command && !command ? String(json.command) : null;
  if (!text && !command && !rejected) return null;
  return { id, text, command, step, rejected };
}

/**
 * Model for tests 2 and 3: the full model when it held the fps gate under game
 * load, otherwise lite. Unmeasured runs fall back to the full model.
 */
export function chooseModel(loadFpsA, loadFpsB, gate = POSE_FPS_GATE) {
  if (loadFpsA == null) return { model: MODEL_A, reason: 'full_not_measured' };
  if (loadFpsA >= gate) return { model: MODEL_A, reason: 'full_meets_gate' };
  if (loadFpsB == null) return { model: MODEL_A, reason: 'lite_not_measured' };
  return { model: MODEL_B, reason: loadFpsB >= gate ? 'only_lite_meets_gate' : 'neither_meets_gate_lite_faster_assumed' };
}

/** What 'redo' targets: the running timed step, or the step before a wait screen. */
export function redoTarget(steps, index) {
  if (steps[index]?.kind === 'timed') return index;
  return Math.max(0, index - 1);
}
