/**
 * Local incident replay, not physical Portal acceptance. Real School UI, fetch
 * client, grading/quota policy and YAML evidence; only transport, catalogue,
 * PDF generation and physical printer are test sinks. No household stack.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SchoolApp from '../../../../__app_modules/learning/school/browser/SchoolApp.jsx';
import { parseSchoolPath } from '../../../../__app_modules/learning/school/browser/schoolPathModel.js';
import { SchoolService } from '../../../../__app_modules/learning/school/server/application/SchoolService.mjs';
import { PrintService } from '../../../../__app_modules/learning/school/server/application/PrintService.mjs';
import { YamlSchoolDatastore } from '../../../../__app_modules/learning/school/server/adapters/persistence/YamlSchoolDatastore.mjs';
import { YamlSittingStore } from '../../../../__app_modules/learning/school/server/adapters/persistence/YamlSittingStore.mjs';

// No live WebSocket and no logger transport. Neither replaces UI/input logic.
vi.mock('../../../../frontend/src/hooks/useWebSocket.js', () => ({ useWebSocketSubscription: () => {} }));
vi.mock('../../../../__app_modules/learning/school/browser/schoolLog.js', () => ({
  schoolLog: new Proxy({}, { get: () => () => {} }),
}));

const VOCAB = 'language/incident/vocabulary';
const SCIENCE = 'science/incident/cells';
const banks = [
  { id: VOCAB, title: 'Vocabulary replay', audience: 'assigned', subject: 'language', items: [
    { id: 'v1', type: 'short_answer', prompt: 'A place for books?', answer: 'reading room' },
  ] },
  { id: SCIENCE, title: 'Science replay', audience: 'assigned', subject: 'science', items: [
    { id: 's1', type: 'short_answer', prompt: 'Cells use what for energy?', answer: 'chemical energy' },
    { id: 's2', type: 'short_answer', prompt: 'Name a cell part.', answer: 'cell wall' },
  ] },
];
const roster = [{ id: 'incident-learner', name: 'Test Learner', birthyear: 2016 }];
const logger = { info() {}, warn() {}, error() {}, debug() {} };
class LostResponse extends Error {}
const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
let tmp, configService, datastore, sittings, service, printer;
let printCalls, gradeCalls, writes, unhandledErrors, transportErrors, opened, exitSchool;
let dropGradeResponse, dropPrintResponse, releaseGrade;
const onError = event => unhandledErrors.push(event.error ?? event.reason ?? event.message);

function reopenStores() {
  datastore = new YamlSchoolDatastore({ configService, logger });
  sittings = new YamlSittingStore({ configService, logger });
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'school-incident-'));
  configService = {
    getDataDir: () => tmp,
    getHouseholdPath: (...parts) => path.join(tmp, 'household', ...parts),
    getUserDir: id => path.join(tmp, 'users', id),
    getUserProfile: id => id === roster[0].id ? { username: id } : null,
  };
  reopenStores();
  printCalls = []; gradeCalls = []; writes = []; opened = []; exitSchool = vi.fn();
  unhandledErrors = []; transportErrors = [];
  dropGradeResponse = false; dropPrintResponse = false; releaseGrade = null;
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onError);
  const users = { getProfile: configService.getUserProfile, getHouseholdRoster: () => roster };
  service = new SchoolService({
    datastore, sittings, userService: users, logger,
    bankSources: [{ resolve: id => banks.find(b => b.id === id), listSummaries: () => banks.map(b => ({ ...b, itemCount: b.items.length })) }],
  });
  printer = new PrintService({
    datastore, userService: users, logger,
    config: { printables: [{ id: 'science-sheet', label: 'Science sheet', type: 'bank', bankId: SCIENCE }] },
    bankReader: service,
    worksheetRenderer: { renderBankWorksheet: async () => ({ pdf: Buffer.from('%PDF-test-sink'), pageCount: 1 }) },
    printerAdapter: { printPdf: async (pdf, options) => { printCalls.push({ pdf, options }); return { ok: true }; } },
  });
  vi.stubGlobal('fetch', vi.fn(async (raw, options = {}) => {
    const url = new URL(String(raw), 'http://localhost');
    const route = url.pathname.replace('/api/v1/school', '');
    const body = options.body ? JSON.parse(options.body) : null;
    if (options.method && options.method !== 'GET') writes.push({ route, body });
    try {
      if (route === '/roster') return json(roster);
      if (route === '/banks') return json(banks.map(b => ({ ...b, itemCount: b.items.length })));
      if (route.startsWith('/banks/')) return json(service.getBank(decodeURIComponent(route.slice(7))));
      if (route === '/sessions') {
        const result = service.openSession(body);
        opened.push({ ...body, ...result });
        return json(result);
      }
      if (/^\/sessions\/[^/]+\/answer$/.test(route)) {
        const sessionId = route.split('/')[2];
        const result = service.answer({ sessionId, ...body });
        if (opened.find(s => s.sessionId === sessionId).bankId === SCIENCE) {
          gradeCalls.push({ sessionId, ...body, result });
          if (dropGradeResponse) {
            await new Promise(resolve => { releaseGrade = resolve; });
            throw new LostResponse('simulated lost grade response after durable commit');
          }
        }
        return json(result);
      }
      if (route === '/print/printables') return json(await printer.listPrintables());
      if (route === '/print/quota') return json(printer.getQuota(url.searchParams.get('userId')));
      if (route === '/print/requests') return json(printer.listRequestsFor(url.searchParams.get('userId')));
      if (route === '/print/request') {
        const result = await printer.requestPrint(body);
        if (dropPrintResponse) throw new LostResponse('simulated lost print response after dispatch');
        return json(result);
      }
      if (route === '/materials') return json({ sections: [], materials: [] });
      if (route === '/catalogs') return json({ catalogs: [] });
      if (route === '/sentence-ladder/courses') return json([]);
      if (route === '/book-scans/pending') return json({ intent: null });
      // Background, read-only panels are deliberately unavailable in this fixture.
      if (!options.method || options.method === 'GET') return json(null, 404);
      throw new Error(`unexpected mutation: ${route}`);
    } catch (error) {
      if (error instanceof LostResponse) throw error; // real schoolApi converts network loss to status 0
      transportErrors.push(error.message);
      return json({ error: error.message }, 500);
    }
  }));
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('school:user', roster[0].id);
  window.history.replaceState({}, '', '/school');
});

afterEach(() => {
  cleanup();
  window.removeEventListener('error', onError);
  window.removeEventListener('unhandledrejection', onError);
  vi.unstubAllGlobals();
  localStorage.clear(); sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  fs.rmSync(tmp, { recursive: true, force: true });
});

function mountSchool() { return render(<SchoolApp mode="open" clear={exitSchool} />); }
async function openQuiz(title) {
  fireEvent.click(await screen.findByRole('button', { name: /^practice/i }));
  const card = (await screen.findByRole('heading', { name: title })).closest('.school-browse__card');
  fireEvent.click(within(card).getByRole('button', { name: 'Quiz' }));
  return screen.findByRole('textbox');
}
function spaceBurst(target, count = 80) {
  // DOM key delivery, including the Portal-shaped code/keyCode and held flag.
  // The test DOM does not synthesize native text editing or a button's default click.
  const down = repeat => {
    const allowed = fireEvent.keyDown(target, { key: ' ', code: 'Space', keyCode: 32, repeat });
    if (target.tagName === 'INPUT') expect(allowed).toBe(true);
  };
  down(false);
  for (let i = 0; i < count; i += 1) down(true);
  fireEvent.keyUp(target, { key: ' ', code: 'Space', keyCode: 32 });
}
function typeText(input, text) {
  input.focus();
  for (const char of text) {
    const allowed = fireEvent.keyDown(input, { key: char, code: char === ' ' ? 'Space' : `Key${char.toUpperCase()}` });
    if (char === ' ') expect(allowed).toBe(true); // global shortcuts must permit normal text spaces
    // Browser default editing is supplied explicitly; the real React onChange
    // and global IME/input handlers still receive each ordinary space.
    fireEvent.change(input, { target: { value: input.value + char } });
    fireEvent.keyUp(input, { key: char, code: char === ' ' ? 'Space' : `Key${char.toUpperCase()}` });
  }
}
async function goHome() {
  fireEvent.click(screen.getByRole('button', { name: 'Home' }));
  // In-flight quiz protects leaving with a second explicit press.
  if (screen.queryByTestId('leave-confirm')) fireEvent.click(screen.getByRole('button', { name: 'Home' }));
  await screen.findByRole('button', { name: 'School' });
}
async function printScience({ lost = false } = {}) {
  fireEvent.click(await screen.findByRole('button', { name: /^print/i }));
  dropPrintResponse = lost;
  fireEvent.click(await screen.findByRole('button', { name: /Science sheet/ }));
  await screen.findByText(lost ? 'Print failed — try again.' : /Printing “Science sheet”/);
  await goHome();
}
async function scienceAnswer({ lost = false } = {}) {
  const input = await openQuiz('Science replay');
  typeText(input, 'chemical energy');
  expect(input.value).toBe('chemical energy');
  spaceBurst(input);
  expect(input.value).toBe('chemical energy');
  dropGradeResponse = lost;
  // Enter plus a Check click while the response is still pending exercises
  // the real item's synchronous submission guard.
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
  fireEvent.click(screen.getByRole('button', { name: 'Check' }));
  if (lost) {
    await waitFor(() => expect(releaseGrade).toBeTypeOf('function'));
    spaceBurst(document.body);
    await act(async () => releaseGrade());
    await screen.findByTestId('unrecorded');
  }
  await screen.findByRole('button', { name: 'Next' });
}

it('vocabulary completion, science grading and Space bursts retain a responsive home', async () => {
  mountSchool();
  const input = await openQuiz('Vocabulary replay');
  typeText(input, 'reading room');
  expect(input.value).toBe('reading room');
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  expect(await screen.findByTestId('quiz-summary')).toHaveTextContent('1 / 1');
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  await goHome();
  await printScience();
  await scienceAnswer({ lost: true });
  await goHome();
  fireEvent.click(screen.getByRole('button', { name: /^practice/i }));
  // Real pressDown handler: first Space returns Home; repeat keydowns must
  // neither activate School's exit nor recreate any work.
  spaceBurst(screen.getByRole('button', { name: 'Home' }));
  expect(await screen.findByRole('button', { name: 'School' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^science/i }));
  expect(await screen.findByRole('heading', { name: 'Science replay' })).toBeTruthy();
  await goHome();
  expect(exitSchool).not.toHaveBeenCalled();
  expect(printCalls).toHaveLength(1);
  expect(gradeCalls).toHaveLength(1);
  expect(datastore.readAllAttempts(roster[0].id).map(a => [a.bankId, a.correct])).toEqual([[VOCAB, true], [SCIENCE, true]]);
  expect(transportErrors).toEqual([]);
  expect(unhandledErrors).toEqual([]);
});

it('recovering the page preserves saved activity evidence without replaying the completed grade', async () => {
  const page = mountSchool();
  await printScience({ lost: true });
  await scienceAnswer();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  typeText(await screen.findByRole('textbox'), 'unfinished cell draft');
  const saved = sittings.read(roster[0].id, SCIENCE);
  expect(saved.answers).toEqual([{ itemId: 's1', correct: true }]);
  const savedActivityId = saved.sessionId;
  const mutationsBeforeReload = writes.length;
  page.unmount();
  reopenStores();
  // An active learner-program URL holds no authority. Recovery may not use
  // /go to mint a grant or pretend that this draft/runner was restored.
  window.history.replaceState({}, '', '/school/sentence-ladder/incident-course');
  expect(parseSchoolPath('/school')).toEqual({ section: null, materialPath: [] });
  mountSchool();
  expect(await screen.findByRole('button', { name: 'School' })).toBeTruthy();
  await screen.findByRole('button', { name: /^science/i });
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByText('unfinished cell draft')).toBeNull();
  const restoredStoredActivityId = sittings.read(roster[0].id, SCIENCE).sessionId;
  expect(restoredStoredActivityId).toBe(savedActivityId);
  expect(datastore.readAllAttempts(roster[0].id)).toHaveLength(1);
  expect(datastore.readPrintLog()).toHaveLength(1);
  expect(writes).toHaveLength(mutationsBeforeReload);
  expect(writes.some(w => /\/act$|direct-launch/.test(w.route))).toBe(false);
  expect(opened).toHaveLength(1);
  expect(exitSchool).not.toHaveBeenCalled();
  expect(printCalls).toHaveLength(1);
  expect(gradeCalls).toHaveLength(1);
  expect(transportErrors).toEqual([]);
  expect(unhandledErrors).toEqual([]);
});
