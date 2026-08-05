#!/usr/bin/env node
/**
 * Generate the reviewable 128x64 SchoolCalc GUI bitmap source.
 *
 * Typography and icon pixels are data under ../gui. Screen composition lives
 * here so every PNG and eventual Z80 renderer can be checked against the same
 * glyph vocabulary.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import QRCode from 'qrcode';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUI_DIR = path.resolve(HERE, '../gui');
const OUTPUT = path.join(GUI_DIR, 'screens.yml');
const WIDTH = 128;
const HEIGHT = 64;
const BODY_TOP = 9;
const BODY_HEIGHT = 46;
const BODY_ROWS = 7;

const typeSpec = yaml.load(fs.readFileSync(path.join(GUI_DIR, 'type.yml'), 'utf8'));
const iconSpec = yaml.load(fs.readFileSync(path.join(GUI_DIR, 'icons.yml'), 'utf8'));
const fonts = new Map(typeSpec.fonts.map((font) => [font.id, font]));
const icons = new Map(iconSpec.icons.map((icon) => [icon.id, icon]));

validateAssets();

const BROWSE_KEYS = ['up', 'down', 'left', 'right', 'enter', 'exit'];
const CATALOG_KEYS = ['up', 'down', 'left', 'right', 'enter', 'exit', 'f1', 'f2', 'f3', 'f4', 'f5'];
const READER_KEYS = ['up', 'down', 'left', 'right', 'enter', 'exit', 'f1', 'f2', 'f4', 'f5'];
const SCREEN_CONTRACTS = Object.freeze({
  home: screenContract('home', 'standard', ['StickyHeader', 'BrowseList', 'ListItem', 'QueueIndicator', 'SoftkeyBar'], 'item', BROWSE_KEYS),
  'profile-picker': screenContract('identity-picker', 'standard', ['StickyHeader', 'IdentityPicker', 'BrowseList', 'ListItem', 'ScrollRail', 'SoftkeyBar'], 'item', BROWSE_KEYS),
  'profile-locked': screenContract('identity-notice', 'standard', ['StickyHeader', 'IdentityStatus', 'SoftkeyBar'], 'none', ['enter', 'exit']),
  'profile-error': screenContract('identity-notice', 'standard', ['StickyHeader', 'IdentityStatus', 'ErrorNotice', 'SoftkeyBar'], 'none', ['enter', 'exit']),
  'my-progress': screenContract('progress-overview', 'standard', [
    'StickyHeader', 'ProgressSummary', 'OverviewCanvas', 'FocusCursor',
    'SelectionInspector', 'SnapNavigation', 'StatusMarker', 'PositionMemory', 'FollowUpList',
  ], 'item', ['up', 'down', 'left', 'right', 'exit', 'f1', 'f5']),
  'tutor-turn': screenContract('tutor-turn', 'standard', ['StickyHeader', 'TutorTurn', 'ChoiceGroup', 'TransportPresence', 'ScrollRail', 'SoftkeyBar'], 'page', ['up', 'down', 'enter', 'exit']),
  'tutor-retry': screenContract('tutor-status', 'standard', ['StickyHeader', 'TutorStatus', 'TransportPresence', 'ErrorNotice', 'SoftkeyBar'], 'none', ['enter', 'exit']),
  catalog: screenContract('catalog', 'standard', ['StickyHeader', 'BrowseList', 'ListItem', 'AvailabilityIndicator', 'ScrollRail', 'ScrollCompletion', 'SoftkeyBar'], 'item', CATALOG_KEYS),
  course: screenContract('course', 'standard', ['StickyHeader', 'BrowseList', 'ListItem', 'ScrollRail', 'ScrollCompletion', 'SoftkeyBar'], 'item', CATALOG_KEYS),
  unit: screenContract('unit', 'standard', ['StickyHeader', 'BrowseList', 'ListItem', 'ScrollRail', 'ScrollCompletion', 'SoftkeyBar'], 'item', CATALOG_KEYS),
  lesson: screenContract('lesson', 'standard', ['StickyHeader', 'BrowseList', 'ListItem', 'ScrollCompletion', 'SoftkeyBar'], 'item', CATALOG_KEYS),
  notes: screenContract('info-document', 'standard', ['StickyHeader', 'BodyRegion', 'InfoDocument', 'ProseBlock', 'ScrollRail', 'ScrollCompletion', 'SoftkeyBar'], 'page', READER_KEYS),
  'study-card': screenContract('study-card', 'standard', ['StickyHeader', 'BodyRegion', 'StudyCard', 'ScrollRail', 'ScrollCompletion', 'SoftkeyBar'], 'card', READER_KEYS),
  'worked-example': screenContract('worked-example', 'standard', ['StickyHeader', 'BodyRegion', 'WorkedExample', 'ScrollRail', 'ScrollCompletion', 'SoftkeyBar'], 'page', READER_KEYS),
  quiz: screenContract('choice-question', 'standard', ['StickyHeader', 'ChoiceGroup', 'CommitAction', 'SoftkeyBar'], 'item', ['up', 'down', 'enter', 'exit']),
  'number-input': screenContract('numeric-response', 'standard', ['StickyHeader', 'NumericField', 'CommitAction', 'SoftkeyBar'], 'none', ['numeric', 'del', 'enter', 'exit']),
  'text-input': screenContract('text-response', 'standard', ['StickyHeader', 'TextField', 'CommitAction', 'SoftkeyBar'], 'none', ['alpha', 'del', 'enter', 'exit']),
  matching: screenContract('matching-activity', 'standard', ['StickyHeader', 'MatchingBoard', 'CommitAction', 'SoftkeyBar'], 'item', ['up', 'down', 'left', 'right', 'enter', 'exit']),
  confirm: screenContract('confirmation', 'modal', ['StickyHeader', 'ConfirmationDialog', 'SoftkeyBar'], 'none', ['enter', 'exit']),
  result: screenContract('result', 'standard', ['StickyHeader', 'ResultSummary', 'QueueIndicator', 'SoftkeyBar'], 'none', ['enter', 'exit']),
  sync: screenContract('sync', 'standard', ['StickyHeader', 'SyncStatus', 'TransportPresence', 'TransferProgress', 'TransferSafety', 'SoftkeyBar'], 'none', ['enter', 'exit']),
  'sync-waiting': screenContract('sync', 'standard', ['StickyHeader', 'SyncStatus', 'TransportPresence', 'TransferSafety', 'SoftkeyBar'], 'none', ['enter', 'exit']),
  'sync-sending': screenContract('sync', 'standard', ['StickyHeader', 'SyncStatus', 'TransportPresence', 'TransportDirection', 'TransferProgress', 'TransferSafety', 'SoftkeyBar'], 'none', ['exit']),
  'sync-receiving': screenContract('sync', 'standard', ['StickyHeader', 'SyncStatus', 'TransportPresence', 'TransportDirection', 'TransferProgress', 'TransferSafety', 'SoftkeyBar'], 'none', ['exit']),
  'sync-validating': screenContract('sync', 'standard', ['StickyHeader', 'SyncStatus', 'TransportPresence', 'TransportDirection', 'TransferSafety', 'SoftkeyBar'], 'none', ['exit']),
  'sync-error': screenContract('sync', 'standard', ['StickyHeader', 'SyncStatus', 'TransportPresence', 'TransferSafety', 'ErrorNotice', 'SoftkeyBar'], 'none', ['enter', 'exit']),
  incompatibility: screenContract('incompatibility', 'standard', ['StickyHeader', 'IncompatibilityNotice', 'ScrollRail', 'SoftkeyBar'], 'reason', ['up', 'down', 'enter', 'exit']),
  storage: screenContract('storage', 'standard', ['StickyHeader', 'StorageSummary', 'ProgressMeter', 'SoftkeyBar'], 'none', ['enter', 'exit']),
  qr: screenContract('qr', 'full_frame', ['QrPresenter'], 'none', ['exit', 'clear', 'on']),
  'qr-result': screenContract('qr-output', 'qr_output', ['QrPresenter', 'OutputReceipt', 'QueueIndicator', 'SoftkeyBar'], 'none', ['f1', 'f5', 'enter', 'exit', 'clear']),
  'native-handoff': screenContract('native-handoff', 'transition', ['StickyHeader', 'ToolInvitation', 'NativeHandoff', 'SoftkeyBar'], 'none', ['enter', 'exit']),
  'catalog-loading': screenContract('local-transition', 'ephemeral', ['StickyHeader', 'LocalTransition'], 'none', []),
  'custom-module': screenContract('custom-module', 'standard', [
    'StickyHeader', 'CustomModuleHost', 'OverviewCanvas', 'FocusCursor',
    'SelectionInspector', 'SnapNavigation', 'StatusMarker', 'PositionMemory', 'SoftkeyBar',
  ], 'item', ['up', 'down', 'left', 'right', 'enter', 'exit']),
});

function makeScreen(id, title, draw) {
  const contract = SCREEN_CONTRACTS[id];
  if (!contract) throw new Error(`screen '${id}' has no design-system contract`);
  const pixels = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
  const interaction = { softkeys: Array(5).fill(null) };
  draw(drawingApi(pixels, interaction));
  return { id, title, ...contract, interaction: { ...contract.interaction, ...interaction }, pixels };
}

function screenContract(template, layout, components, scrollModel, hardwareKeys) {
  return {
    template,
    layout,
    components: Object.freeze([...components]),
    interaction: Object.freeze({
      scroll_model: scrollModel,
      hardware_keys: Object.freeze([...hardwareKeys]),
    }),
  };
}

function drawingApi(pixels, interaction) {
  const pixel = (x, y, on = true) => {
    if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) pixels[y][x] = on;
  };
  const rect = (x, y, width, height, on = true) => {
    for (let yy = y; yy < y + height; yy += 1) {
      for (let xx = x; xx < x + width; xx += 1) pixel(xx, yy, on);
    }
  };
  const frame = (x, y, width, height, on = true) => {
    for (let xx = x; xx < x + width; xx += 1) {
      pixel(xx, y, on);
      pixel(xx, y + height - 1, on);
    }
    for (let yy = y; yy < y + height; yy += 1) {
      pixel(x, yy, on);
      pixel(x + width - 1, yy, on);
    }
  };
  const fontText = (fontId, x, y, value, on = true) => {
    const font = fonts.get(fontId);
    const renderedValue = font.case === 'uppercase'
      ? String(value).toUpperCase()
      : String(value);
    const renderedWidth = fontRenderedWidth(font, renderedValue);
    const renderedHeight = font.height + (fontValueHasDescender(font, renderedValue) ? 1 : 0);
    if (x < 0 || y < 0 || x + renderedWidth > WIDTH || y + renderedHeight > HEIGHT) {
      throw new Error(`${fontId} text '${renderedValue}' escapes the 128x64 canvas at ${x},${y}`);
    }
    let cursorX = x;
    [...renderedValue].forEach((character) => {
      const sourceCharacter = font.glyphs[character] ? character : '?';
      const rows = font.glyphs[sourceCharacter];
      if (!rows) throw new Error(`${fontId} has no glyph for '${character}'`);
      rows.forEach((row, yy) => [...row].forEach((cell, xx) => {
        if (cell === typeSpec.filled) pixel(cursorX + xx, y + yy, on);
      }));
      const descender = font.descender_rows?.[sourceCharacter];
      if (descender) [...descender].forEach((cell, xx) => {
        if (cell === typeSpec.filled) pixel(cursorX + xx, y + font.height, on);
      });
      cursorX += glyphAdvance(font, sourceCharacter);
    });
  };
  const textWidth = (fontId, value) => {
    const font = fonts.get(fontId);
    const renderedValue = font.case === 'uppercase'
      ? String(value).toUpperCase()
      : String(value);
    return fontRenderedWidth(font, renderedValue);
  };
  const text = (x, y, value, on = true) => fontText('compact-3x5', x, y, value, on);
  const readerText = (x, y, value, on = true) => fontText('reader-4x6', x, y, value, on);
  const displayText = (x, y, value, on = true) => fontText('display-5x7', x, y, value, on);
  const wrappedFontText = (fontId, x, y, value, {
    right = WIDTH - 1,
    bottom = HEIGHT - 1,
    lineHeight = fonts.get(fontId)?.advance_y,
    on = true,
  } = {}) => {
    const font = fonts.get(fontId);
    if (!font || !Number.isInteger(lineHeight) || right < x || bottom < y) {
      throw new Error(`${fontId} wrapped text has invalid bounds`);
    }
    const lines = wrapFontValue(font, String(value), right - x + 1);
    if (lines.some((line, index) => (
      y + index * lineHeight + font.height - 1 + (fontValueHasDescender(font, line) ? 1 : 0) > bottom
    ))) {
      throw new Error(`${fontId} wrapped text '${value}' escapes its ${x},${y}..${right},${bottom} region`);
    }
    lines.forEach((line, index) => fontText(fontId, x, y + index * lineHeight, line, on));
    return lines;
  };
  const readerWrappedText = (x, y, value, options) => (
    wrappedFontText('reader-4x6', x, y, value, options)
  );
  const drawIcon = (x, y, id, on = true) => {
    const icon = icons.get(id);
    if (!icon) throw new Error(`unknown SchoolCalc icon '${id}'`);
    icon.pixels.forEach((row, yy) => [...row].forEach((cell, xx) => {
      if (cell === iconSpec.filled) pixel(x + xx, y + yy, on);
    }));
  };
  const rule = (y, x = 0, width = WIDTH) => rect(x, y, width, 1);
  const availabilityBullet = (x, y, state, { blinkOn = true } = {}) => {
    if (!['installed', 'remote', 'downloading'].includes(state)) {
      throw new Error(`unknown availability state '${state}'`);
    }
    const filled = state === 'installed' || (state === 'downloading' && blinkOn);
    [[1, 0], [2, 0], [0, 1], [3, 1], [0, 2], [3, 2], [1, 3], [2, 3]]
      .forEach(([xx, yy]) => pixel(x + xx, y + yy));
    if (filled) rect(x + 1, y + 1, 2, 2);
  };
  const rail = ({ total, visible, offset }) => {
    for (let y = BODY_TOP; y <= 54; y += 2) pixel(127, y);
    const thumbHeight = Math.max(6, Math.round(BODY_HEIGHT * visible / total));
    const travel = BODY_HEIGHT - thumbHeight;
    const top = BODY_TOP + Math.round(travel * offset / Math.max(1, total - visible));
    rect(125, top, 3, thumbHeight);
  };
  const list = (items, {
    selected = 0,
    total = items.length,
    offset = 0,
    badges = {},
    availability = {},
    blinkOn = true,
  } = {}) => {
    const hasAvailability = Object.keys(availability).length > 0;
    items.forEach((label, index) => {
      const y = BODY_TOP + index * 6;
      if (index === selected) text(0, y, '>');
      if (availability[index]) availabilityBullet(5, y, availability[index], { blinkOn });
      text(hasAvailability ? 13 : 5, y, label);
      const badge = badges[index];
      if (badge) text(123 - textWidth('compact-3x5', badge), y, badge);
    });
    if (total > items.length) rail({ total, visible: items.length, offset });
  };
  const softkeys = (actions) => {
    if (!Array.isArray(actions) || actions.length !== 5) {
      throw new Error('softkeys require exactly five fixed F1-F5 entries');
    }
    interaction.softkeys = actions.map(normalizeSoftkey);
    rule(55);
    const edges = [0, 26, 51, 77, 102, 128];
    actions.forEach((action, index) => {
      if (!action) return;
      const x = edges[index];
      const width = edges[index + 1] - x - 1;
      rect(x, 56, width, 8);
      const label = action.label ?? '';
      const iconWidth = action.icon ? iconSpec.icon_width : 0;
      const labelWidth = textWidth('compact-3x5', label);
      const contentWidth = iconWidth + (iconWidth && labelWidth ? 1 : 0) + labelWidth;
      if (contentWidth > width) {
        throw new Error(`softkey ${index + 1} content is ${contentWidth}px; slot allows ${width}px`);
      }
      let cursorX = x + Math.floor((width - contentWidth) / 2);
      if (action.icon) {
        drawIcon(cursorX, 56, action.icon, false);
        cursorX += iconWidth + (labelWidth ? 1 : 0);
      }
      if (label) text(cursorX, 57, label, false);
    });
  };
  // Some optical-output screens reserve the usual rail geometry but cannot
  // afford filled softkey cells: a QR quiet zone needs the adjacent pixels to
  // remain blank. Keep the action semantics in the golden without inventing
  // chrome that the Z80 renderer intentionally does not draw.
  const softkeyActions = (actions) => {
    if (!Array.isArray(actions) || actions.length !== 5) {
      throw new Error('softkey actions require exactly five fixed F1-F5 entries');
    }
    interaction.softkeys = actions.map(normalizeSoftkey);
  };
  const progress = (x, y, width, value, total) => {
    rule(y, x, width);
    rule(y + 3, x, width);
    pixel(x, y + 1);
    pixel(x, y + 2);
    pixel(x + width - 1, y + 1);
    pixel(x + width - 1, y + 2);
    rect(x + 2, y + 1, Math.round((width - 4) * value / total), 2);
  };
  return {
    pixel, rect, frame, text, readerText, readerWrappedText, displayText, textWidth, drawIcon,
    rule, rail, availabilityBullet, list, softkeys, softkeyActions, progress,
  };
}

function normalizeSoftkey(action) {
  if (!action) return null;
  const aliases = { CAT: 'catalog', QUE: 'queue', '.': 'decimal', '+/-': 'sign' };
  const source = action.id ?? aliases[action.label] ?? action.label ?? action.icon;
  const actionId = String(source ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!actionId) throw new Error('softkey action requires a semantic id, label, or icon');
  return {
    action: actionId,
    ...(action.label ? { label: action.label } : {}),
    ...(action.icon ? { icon: action.icon } : {}),
  };
}

function header(g, label, right = '') {
  g.rect(0, 0, WIDTH, 8);
  g.text(1, 1, label, false);
  if (right) g.text(124 - g.textWidth('compact-3x5', right), 1, right, false);
}

function drawActionQr(g, token) {
  const qr = QRCode.create([
    { data: 'sch:', mode: 'byte' },
    { data: token, mode: 'alphanumeric' },
  ], { version: 1, errorCorrectionLevel: 'L' });
  if (qr.modules.size !== 21) throw new Error('School action golden must remain QR Version 1');
  const scale = 2;
  const quietModules = 4;
  const fullSize = (qr.modules.size + quietModules * 2) * scale;
  const left = Math.floor((WIDTH - fullSize) / 2) + quietModules * scale;
  const top = Math.floor((HEIGHT - fullSize) / 2) + quietModules * scale;
  for (let y = 0; y < qr.modules.size; y += 1) {
    for (let x = 0; x < qr.modules.size; x += 1) {
      if (qr.modules.get(x, y)) g.rect(left + x * scale, top + y * scale, scale, scale);
    }
  }
}

function drawResultQr(g) {
  // This is the same 37×37 V5/M one-pixel symbol used by SCQR. The payload is
  // representative only; result bytes are built dynamically on the TI-86.
  const qr = QRCode.create([
    { data: 'sch:r1:', mode: 'byte' },
    { data: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', mode: 'alphanumeric' },
  ], { version: 5, errorCorrectionLevel: 'M', maskPattern: 0 });
  if (qr.modules.size !== 37) throw new Error('School result QR golden must remain QR Version 5');
  const left = 45;
  const top = 13;
  for (let y = 0; y < qr.modules.size; y += 1) {
    for (let x = 0; x < qr.modules.size; x += 1) {
      if (qr.modules.get(x, y)) g.pixel(left + x, top + y);
    }
  }
  g.rule(55);
  g.text(5, 58, 'MARK');
  g.text(104, 58, 'LATER');
  g.softkeyActions([
    { id: 'record-qr-output', label: 'MARK' },
    null,
    null,
    null,
    { id: 'defer-qr-output', label: 'LATER' },
  ]);
}

const screens = [
  makeScreen('home', 'Compact home list', (g) => {
    header(g, 'SCHOOLCALC', 'Q2');
    g.list(
      ['CONTINUE', 'CATALOG', 'RESULTS QUEUE', 'SYNC', 'DEVICE', 'STORAGE', 'SETTINGS'],
      { selected: 0, total: 8, badges: { 2: '2', 4: '86A', 5: '68K' } },
    );
    g.softkeys([
      { icon: 'menu', label: 'CAT' },
      { icon: 'queue', label: 'QUE' },
      { icon: 'sync', label: 'SYNC' },
      null,
      null,
    ]);
  }),
  makeScreen('profile-picker', 'Remembered learner profile and synthetic Guest', (g) => {
    header(g, 'WHO IS STUDYING?', '5/9');
    ['GAMMA', 'DELTA', 'EPSILON', 'ZETA', 'ETA', 'GUEST'].forEach((label, index) => {
      const y = 10 + index * 6;
      if (index === 1) {
        g.text(0, y, '>');
        g.text(4, y, '*');
      }
      g.text(9, y, label);
    });
    g.rail({ total: 9, visible: 6, offset: 3 });
    g.softkeys([
      { id: 'select-profile', label: 'SELECT' },
      { id: 'show-progress', label: 'PROG' },
      null,
      null,
      { id: 'select-guest', label: 'GUEST' },
    ]);
  }),
  makeScreen('profile-locked', 'Profile switching blocked by immutable active-session attribution', (g) => {
    header(g, 'PROFILE LOCKED', 'USER');
    g.readerText(2, 15, 'Work is still active.');
    g.readerText(2, 29, 'Finish or save it');
    g.readerText(2, 43, 'before switching.');
    g.softkeys([{ id: 'acknowledge', label: 'OK' }, null, null, null, null]);
  }),
  makeScreen('profile-error', 'Fail-closed profile recovery notice', (g) => {
    header(g, 'PROFILES STOPPED', 'STOP');
    g.readerText(2, 15, 'Local data is safe.');
    g.readerText(2, 29, 'Roster is invalid.');
    g.readerText(2, 43, 'Sync, then retry.');
    g.softkeys([{ id: 'acknowledge', label: 'OK' }, null, null, null, null]);
  }),
  makeScreen('my-progress', 'Curriculum history overview with movable focus and stable inspector', (g) => {
    header(g, 'MY PROGRESS', 'SOREN');
    g.readerText(2, 10, 'Fractions');
    g.text(2, 19, 'TYPE');
    g.text(24, 19, 'C');
    g.text(124 - g.textWidth('compact-3x5', '75%'), 19, '75%');
    g.text(2, 26, 'A');
    g.text(25, 26, '2');
    g.text(58, 26, 'D');
    g.text(88, 26, '1');
    ['S', 'C', 'U', 'L', 'M', 'L', 'M', 'C', 'U', 'L', 'M!', 'L'].forEach((kind, index) => {
      const x = 2 + (index % 6) * 21;
      const y = index < 6 ? 36 : 46;
      if (index === 1) {
        g.rect(x, y, 18, 8);
        g.text(x + 6, y + 1, kind, false);
      } else {
        g.text(x + 6, y + 1, kind);
      }
    });
    g.softkeys([
      { id: 'invoke-follow-up', label: 'TUTOR' }, null, null, null,
      { id: 'switch-user', label: 'SWITCH' },
    ]);
  }),
  makeScreen('tutor-turn', 'Connected adaptive tutor turn with direct A-E choices', (g) => {
    header(g, 'TUTOR: VELOCITY', 'LIVE 2/4');
    g.readerText(1, 9, 'Speed tells how fast');
    g.readerText(1, 16, 'distance changes.');
    g.readerText(1, 24, 'If distance doubles');
    g.readerText(1, 31, 'in the same time,');
    g.readerText(1, 38, 'what also doubles?');
    g.text(5, 45, 'A SPEED  B TIME  C MASS');
    g.text(5, 50, 'D FORCE  E ENERGY');
    g.rail({ total: 4, visible: 1, offset: 1 });
    g.softkeys([
      { icon: 'a' }, { icon: 'b' }, { icon: 'c' }, { icon: 'd' }, { icon: 'e' },
    ]);
  }),
  makeScreen('tutor-retry', 'Tutor disconnect retains the exact request for retry', (g) => {
    header(g, 'TUTOR PAUSED', 'OFFLINE');
    g.readerText(2, 12, 'Connection was lost.');
    g.readerText(2, 24, 'Your answer is saved.');
    g.readerText(2, 36, 'Reconnect, then retry');
    g.readerText(2, 43, 'the same request.');
    g.softkeys([{ icon: 'sync', label: 'TRY' }, null, null, null, null]);
  }),
  makeScreen('catalog', 'Installed Catalog subject list', (g) => {
    header(g, 'SUBJECTS', 'SOREN');
    g.list(
      ['PHYSICS', 'CHEMISTRY', 'FINANCE', 'ECONOMICS', 'ALGEBRA I', 'GEOMETRY', 'STATISTICS'],
      {
        selected: 0,
        total: 12,
        offset: 0,
        availability: {
          0: 'installed',
          1: 'remote',
          2: 'downloading',
          3: 'remote',
          4: 'installed',
          5: 'remote',
          6: 'remote',
        },
      },
    );
    g.softkeys([
      { label: 'OPEN' },
      { label: 'BACK' },
      { id: 'open-user-profile', label: 'USER' },
      null,
      { label: 'SYNC' },
    ]);
  }),
  makeScreen('course', 'Course unit browser', (g) => {
    header(g, 'PHYSICS', 'COURSES');
    g.list(
      ['INTRO PHYSICS', 'FORCE & MOTION', 'ENERGY', 'WAVES', 'ELECTRICITY', 'REVIEW'],
      { selected: 1, total: 8, offset: 0, badges: { 0: 'ON', 1: 'ON', 2: 'GET', 3: 'GET' } },
    );
    g.softkeys([
      { label: 'OPEN' },
      { label: 'BACK' },
      null,
      null,
      { label: 'MORE' },
    ]);
  }),
  makeScreen('unit', 'Unit lesson browser', (g) => {
    header(g, 'INTRO PHYSICS', 'UNITS');
    g.list(
      ['POSITION', 'VELOCITY', 'ACCELERATION', 'GRAPH MOTION', 'FREE FALL', 'REVIEW', 'UNIT CHECK'],
      { selected: 1, total: 9, offset: 0, badges: { 0: 'DONE', 1: 'ON', 2: 'GET', 6: 'QUIZ' } },
    );
    g.softkeys([
      { label: 'OPEN' },
      { label: 'BACK' },
      null,
      { label: 'DEL' },
      { label: 'MORE' },
    ]);
  }),
  makeScreen('lesson', 'Compact lesson module list', (g) => {
    header(g, 'VELOCITY', 'MODULES');
    g.list(['NOTES', 'EXAMPLES', 'DRILL', 'QUIZ', 'GRAPH LAB', 'FLASHCARDS', 'WORKSHEET'], {
      selected: 0,
      badges: { 2: '12', 3: '5', 6: 'QR' },
    });
    g.softkeys([
      { label: 'OPEN' },
      { label: 'BACK' },
      null,
      null,
      { label: 'MORE' },
    ]);
  }),
  makeScreen('notes', 'Sticky-header compact lecture notes', (g) => {
    header(g, 'NOTES', '2/4');
    [
      'Speed tells how far an',
      'object moves in a given',
      'amount of time.',
      'v = distance / time',
      'Example: 100 m / 20 s',
      '= 5 m/s',
    ].forEach((line, index) => g.readerText(1, BODY_TOP + index * 7, line));
    g.rail({ total: 10, visible: 6, offset: 2 });
    g.softkeys([
      { label: 'TOP' }, { label: 'BACK' }, null, { label: 'PGUP' }, { label: 'MORE' },
    ]);
  }),
  makeScreen('study-card', 'Sticky-header compact study card', (g) => {
    header(g, 'FLASHCARD', '3/20');
    [
      'Compound interest',
      'Interest earned on the',
      'principal plus all prior',
      'interest.',
      'A = P(1 + r/n)^(nt)',
      'Down for definitions...',
    ].forEach((line, index) => g.readerText(1, BODY_TOP + index * 7, line));
    g.rail({ total: 9, visible: 6, offset: 0 });
    g.softkeys([
      { icon: 'flip', label: 'FLIP' },
      { icon: 'mark', label: 'MARK' },
      null,
      null,
      null,
    ]);
  }),
  makeScreen('worked-example', 'Scrollable worked example at end of module', (g) => {
    header(g, 'WORKED EXAMPLE', '3/3');
    [
      'A cart moves 12 m',
      'in 3 seconds.',
      '1. Use v = d / t.',
      '2. Put in 12 m and 3 s.',
      '3. v = 4 m/s.',
      'Check: 4 x 3 = 12 m.',
    ].forEach((line, index) => g.readerText(1, BODY_TOP + index * 7, line));
    g.rail({ total: 8, visible: 6, offset: 2 });
    g.softkeys([
      { label: 'TOP' }, { label: 'BACK' }, null, { label: 'PGUP' }, { label: 'EOM' },
    ]);
  }),
  makeScreen('quiz', 'Compact multiple-choice input', (g) => {
    header(g, 'QUIZ', '2/5');
    g.text(2, 11, 'WHAT IS 12 DIVIDED');
    g.text(2, 17, 'BY 3?');
    g.text(2, 32, 'A) 3');
    g.text(2, 38, 'B) 4');
    g.text(2, 44, 'C) 6');
    g.text(2, 50, 'D) 9');
    g.softkeys([
      { id: 'choice-a', label: 'A' }, { id: 'choice-b', label: 'B' },
      { id: 'choice-c', label: 'C' }, { id: 'choice-d', label: 'D' },
      null,
    ]);
  }),
  makeScreen('number-input', 'Mixed-size numeric answer input', (g) => {
    header(g, 'ENTER ANSWER', '2/5');
    g.readerText(1, 10, 'Acceleration?');
    g.displayText(7, 20, '9.8');
    g.rule(28, 7, 70);
    g.rect(24, 30, 5, 1);
    g.readerText(1, 36, 'Units: m/s^2');
    g.text(1, 45, 'ENTER TO SUBMIT');
    g.softkeys([
      { label: 'UNIT' },
      { label: '.' },
      { label: '+/-' },
      { icon: 'close', label: 'CLR' },
      null,
    ]);
  }),
  makeScreen('text-input', 'Mixed-case text answer input', (g) => {
    header(g, 'SHORT ANSWER', '3/5');
    g.readerText(1, 10, 'Name the quantity shown');
    g.readerText(1, 17, 'by distance divided');
    g.readerText(1, 24, 'by time.');
    g.readerText(7, 34, 'velocity');
    g.rule(42, 7, 112);
    g.rect(47, 44, 1, 6);
    g.text(1, 49, 'ALPHA TEXT');
    g.softkeys([
      { id: 'case', label: 'Aa' },
      { id: 'space', label: 'SPACE' },
      { icon: 'close', label: 'CLR' },
      null,
      null,
    ]);
  }),
  makeScreen('matching', 'Generic matching activity', (g) => {
    header(g, 'MATCHING', '1/4');
    g.text(1, 10, '> SPEED');
    g.text(70, 10, 'A  M/S');
    g.text(5, 18, 'TIME');
    g.text(70, 18, 'B  M');
    g.text(5, 26, 'DISTANCE');
    g.text(70, 26, 'C  S');
    g.rule(35, 0, 124);
    g.readerText(2, 39, 'Select a term, then');
    g.readerText(2, 46, 'select its match.');
    g.softkeys([
      { id: 'pair', label: 'PAIR' },
      { id: 'undo', label: 'UNDO' },
      null,
      null,
      { icon: 'check', label: 'DONE' },
    ]);
  }),
  makeScreen('confirm', 'Compact modal confirmation', (g) => {
    header(g, 'KINEMATICS', '1/7');
    g.rect(14, 10, 100, 43, false);
    g.frame(14, 10, 100, 43);
    g.readerWrappedText(21, 14, 'Remove this lesson?', { right: 106, bottom: 25 });
    g.readerWrappedText(21, 27, 'Frees 2.4 KB', { right: 106, bottom: 33 });
    g.readerWrappedText(21, 38, 'NO is the safe choice', { right: 106, bottom: 50 });
    g.softkeys([
      { icon: 'close', label: 'NO' },
      null,
      null,
      null,
      { icon: 'check', label: 'YES' },
    ]);
  }),
  makeScreen('result', 'Compact queued result actions', (g) => {
    header(g, 'RESULT', 'QUIZ');
    g.text(1, 9, 'SCORE');
    g.displayText(92, 9, '4/5');
    g.text(1, 18, 'PERCENT');
    g.displayText(92, 18, '80%');
    g.text(1, 28, 'RESULT #18 QUEUED');
    g.rule(34, 0, 124);
    g.readerText(5, 38, 'QR works without cable.');
    g.readerText(5, 45, 'Sync ACKs this record.');
    g.softkeys([
      { icon: 'qr', label: 'QR' },
      { icon: 'sync', label: 'SYNC' },
      { icon: 'info', label: 'INFO' },
      null,
      null,
    ]);
  }),
  makeScreen('sync', 'Compact cable sync status', (g) => {
    header(g, 'SYNC', '86A001');
    [
      'RESULTS SENT: 2/2',
      'ACKNOWLEDGED: 2',
      'CATALOG CURRENT',
      'LESSON INSTALLED: 1',
      'FREE CONTENT SPACE: 68 KB',
      'SAFE TO UNPLUG',
    ].forEach((line, index) => g.text(1, BODY_TOP + index * 7, line));
    g.progress(1, 49, 122, 4, 4);
    g.softkeys([{ icon: 'sync', label: 'TRY' }, null, null, null, null]);
  }),
  makeScreen('sync-waiting', 'Transport waiting with honest cable presence', (g) => {
    header(g, 'SYNC', '86A001');
    [
      'RELAY: WAITING',
      'IDLE CABLE: UNKNOWN',
      'QUEUE: 2 RESULTS',
      'CONNECT RELAY, THEN TRY',
      'NO TRANSFER ACTIVE',
      'SAFE TO UNPLUG',
    ].forEach((line, index) => g.text(1, BODY_TOP + index * 7, line));
    g.softkeys([{ icon: 'sync', label: 'TRY' }, null, null, null, null]);
  }),
  makeScreen('sync-sending', 'Verified session sending calculator data', (g) => {
    header(g, 'SYNC', 'SEND 2/4');
    [
      'RELAY: VERIFIED',
      'SENDING TO RELAY',
      'RESULT QUEUE',
      '1.8 KB OF 2.4 KB',
      'KEEP CABLE CONNECTED',
    ].forEach((line, index) => g.text(1, BODY_TOP + index * 7, line));
    g.progress(1, 45, 122, 18, 24);
    g.softkeys([null, null, null, null, null]);
  }),
  makeScreen('sync-receiving', 'Verified session receiving calculator data', (g) => {
    header(g, 'SYNC', 'GET 1/3');
    [
      'RELAY: VERIFIED',
      'RECEIVING FROM RELAY',
      'LESSON 1 OF 3',
      '5.2 KB OF 8.0 KB',
      'KEEP CABLE CONNECTED',
    ].forEach((line, index) => g.text(1, BODY_TOP + index * 7, line));
    g.progress(1, 45, 122, 52, 80);
    g.softkeys([null, null, null, null, null]);
  }),
  makeScreen('sync-validating', 'Transfer complete with local validation', (g) => {
    header(g, 'SYNC', 'CHECK');
    [
      'TRANSFER COMPLETE',
      'VALIDATING LOCALLY',
      'CATALOG: VERIFIED',
      'QUEUE: ACKNOWLEDGED',
      'COMMITTING SNAPSHOT',
      'SAFE TO UNPLUG',
    ].forEach((line, index) => g.text(1, BODY_TOP + index * 7, line));
    g.softkeys([null, null, null, null, null]);
  }),
  makeScreen('sync-error', 'Stopped transport with recovery guidance', (g) => {
    header(g, 'SYNC', 'STOPPED');
    [
      'TRANSFER STOPPED',
      'NO QUEUED RESULT LOST',
      'CHECK CABLE + RELAY',
      'RECONNECT, THEN RETRY',
      'ERROR: LINK TIMEOUT',
      'SAFE TO UNPLUG',
    ].forEach((line, index) => g.text(1, BODY_TOP + index * 7, line));
    g.softkeys([{ icon: 'sync', label: 'TRY' }, { icon: 'info', label: 'INFO' }, null, null, null]);
  }),
  makeScreen('incompatibility', 'Scrollable incompatibility reason', (g) => {
    header(g, 'LESSONS');
    g.text(3, 11, 'NOT COMPATIBLE');
    g.readerText(3, 20, 'This lesson needs');
    g.readerText(3, 27, 'response.text@1.');
    g.readerText(3, 34, 'The installed client');
    g.readerText(3, 41, 'does not provide it.');
    g.text(3, 50, 'ARROWS MORE  ENTER BACK');
    g.rail({ total: 3, visible: 1, offset: 0 });
    g.softkeys([null, null, null, null, null]);
  }),
  makeScreen('storage', 'Storage and install capacity', (g) => {
    header(g, 'STORAGE', '86A001');
    g.text(1, 10, 'CLIENT       48.7 KB');
    g.text(1, 17, 'CATALOG       3.2 KB');
    g.text(1, 24, 'LESSONS      18.4 KB');
    g.text(1, 31, 'QUEUES        1.1 KB');
    g.text(1, 38, 'PROTECTED    10.0 KB');
    g.text(1, 47, 'FREE         17.6 KB');
    g.progress(83, 48, 40, 62, 100);
    g.softkeys([{ icon: 'info', label: 'INFO' }, null, null, null, null]);
  }),
  makeScreen('qr', 'Dedicated full-frame School action QR', (g) => {
    drawActionQr(g, 'ABCDEFGHIJKLMNOP');
  }),
  makeScreen('qr-result', 'Queued result QR with self-reported receipt actions', (g) => {
    drawResultQr(g);
  }),
  makeScreen('native-handoff', 'Native calculator transition', (g) => {
    header(g, 'GRAPH TOOL', 'READY');
    g.readerText(2, 12, 'Your place is saved.');
    g.readerText(2, 20, 'Y1 and the graph window');
    g.readerText(2, 28, 'will be prepared safely.');
    g.readerText(2, 39, 'ENTER opens TI graphing.');
    g.text(2, 49, 'RELAUNCH SCHOOLCALC TO RETURN');
    g.softkeys([{ icon: 'info', label: 'INFO' }, null, null, null, null]);
  }),
  makeScreen('catalog-loading', 'Immediate local Catalog transition', (g) => {
    header(g, 'COURSES');
    g.text(61, 29, '...');
  }),
  makeScreen('custom-module', 'Registered custom module host', (g) => {
    header(g, 'INTERACTIVE', '4/6');
    g.readerText(2, 10, 'Rate');
    g.text(2, 19, 'VALUE 4.0');
    g.text(64, 19, 'STATE ACTIVE');
    g.text(2, 26, 'ARROWS MOVE FOCUS');
    g.rule(42, 7, 112);
    [8, 28, 48, 68, 88, 108].forEach((x, index) => {
      if (index === 3) {
        g.frame(x - 2, 38, 7, 9);
        g.rect(x, 41, 3, 3);
      } else if (index === 5) {
        g.frame(x, 41, 3, 3);
      } else {
        g.rect(x, 41, 3, 3);
      }
    });
    g.text(2, 49, 'OVERVIEW + STABLE INSPECTOR');
    g.softkeys([
      { id: 'run', label: 'RUN' },
      { id: 'reset', label: 'RESET' },
      { icon: 'info', label: 'INFO' },
      null,
      null,
    ]);
  }),
];

const output = serializeScreens(screens);
if (process.argv.includes('--check')) {
  if (!fs.existsSync(OUTPUT) || fs.readFileSync(OUTPUT, 'utf8') !== output) {
    console.error(`${OUTPUT} is stale; run tools/generate-gui.mjs`);
    process.exit(1);
  }
  console.log(`SchoolCalc GUI source is current (${screens.length} screens)`);
} else {
  fs.writeFileSync(OUTPUT, output);
  console.log(`Generated ${screens.length} SchoolCalc screens at ${OUTPUT}`);
}

function serializeScreens(values) {
  const lines = [
    'schema: schoolcalc.gui/v1',
    `screen_width: ${WIDTH}`,
    `screen_height: ${HEIGHT}`,
    'pixel_scale: 1',
    'blank: "."',
    'filled: "█"',
    'screens:',
  ];
  for (const screen of values) {
    lines.push(
      `  - id: ${screen.id}`,
      `    title: ${JSON.stringify(screen.title)}`,
      `    template: ${screen.template}`,
      `    layout: ${screen.layout}`,
      '    components:',
      ...screen.components.map((component) => `      - ${component}`),
      '    interaction:',
      `      scroll_model: ${screen.interaction.scroll_model}`,
      `      hardware_keys: [${screen.interaction.hardware_keys.join(', ')}]`,
      '      softkeys:',
      ...screen.interaction.softkeys.map((softkey) => (
        softkey
          ? `        - ${JSON.stringify(softkey)}`
          : '        - null'
      )),
      '    pixels:',
    );
    for (const row of screen.pixels) {
      lines.push(`      - "${row.map((value) => (value ? '█' : '.')).join('')}"`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function validateAssets() {
  if (typeSpec?.schema !== 'schoolcalc.type/v1') throw new Error('invalid SchoolCalc type schema');
  if (iconSpec?.schema !== 'schoolcalc.icons/v1') throw new Error('invalid SchoolCalc icon schema');
  for (const font of typeSpec.fonts ?? []) {
    for (const [character, rows] of Object.entries(font.glyphs ?? {})) {
      if (rows.length !== font.height || rows.some((row) => [...row].length !== font.width)) {
        throw new Error(`${font.id} glyph '${character}' does not match ${font.width}x${font.height}`);
      }
    }
    validateGlyphAdvances(font);
  }
  for (const icon of iconSpec.icons ?? []) {
    if (icon.pixels.length !== iconSpec.icon_height
      || icon.pixels.some((row) => [...row].length !== iconSpec.icon_width)) {
      throw new Error(`icon '${icon.id}' does not match ${iconSpec.icon_width}x${iconSpec.icon_height}`);
    }
  }
}

function glyphAdvance(font, character) {
  return font.glyph_advances?.[character] ?? font.advance_x;
}

function fontRenderedWidth(font, value) {
  const characters = [...value];
  if (characters.length === 0) return 0;
  return characters.reduce((width, character) => {
    const sourceCharacter = font.glyphs[character] ? character : '?';
    return width + glyphAdvance(font, sourceCharacter);
  }, 0) - 1;
}

function fontValueHasDescender(font, value) {
  return [...value].some((character) => {
    const sourceCharacter = font.glyphs[character] ? character : '?';
    return Boolean(font.descender_rows?.[sourceCharacter]);
  });
}

function wrapFontValue(font, value, maxWidth) {
  if (!Number.isInteger(maxWidth) || maxWidth < 1) throw new Error('wrapped text width must be positive');
  const lines = [];
  String(value).split('\n').forEach((paragraph) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      return;
    }
    let line = '';
    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      if (fontRenderedWidth(font, candidate) <= maxWidth) {
        line = candidate;
        return;
      }
      if (line) {
        lines.push(line);
        line = '';
      }
      let chunk = '';
      [...word].forEach((character) => {
        const next = chunk + character;
        if (chunk && fontRenderedWidth(font, next) > maxWidth) {
          lines.push(chunk);
          chunk = character;
        } else {
          chunk = next;
        }
      });
      line = chunk;
    });
    if (line) lines.push(line);
  });
  return lines;
}

function validateGlyphAdvances(font) {
  const advances = font.glyph_advances ?? {};
  if (font.proportional !== true && Object.keys(advances).length > 0) {
    throw new Error(`${font.id}: glyph_advances require proportional: true`);
  }
  for (const [character, advance] of Object.entries(advances)) {
    if (!font.glyphs?.[character] || !Number.isInteger(advance) || advance < 1 || advance > font.advance_x) {
      throw new Error(`${font.id}: invalid glyph advance for '${character}'`);
    }
  }
  for (const [character, row] of Object.entries(font.descender_rows ?? {})) {
    if (!font.glyphs?.[character] || [...row].length !== font.width
      || [...row].some((pixel) => pixel !== typeSpec.blank && pixel !== typeSpec.filled)) {
      throw new Error(`${font.id}: invalid descender row for '${character}'`);
    }
  }
}
