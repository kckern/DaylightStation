// The debrief in a real browser (Chromium, 1280x800, the School Portal's
// screen): the real SchoolDebriefProgram inside the real activity frame, with
// its SCSS, the frame's SCSS and the school tokens. Only the HTTP clients, the
// recorder, the input-stall timer and logging are replaced. Every step is
// checked for anything that spills out of the panel or the screen, and saved
// as a screenshot. Set DEBRIEF_SHOTS to a folder to keep them somewhere else.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../../..');
const require = createRequire(path.join(ROOT, 'frontend/package.json'));
const SHOTS = process.env.DEBRIEF_SHOTS || path.join(os.tmpdir(), 'school-debrief-shots');

const stubs = [
  [/lib\/logging\/Logger\.js$/, `const L={}; for(const level of ['info','warn','error','debug','sampled']) L[level]=(event,data)=>{ (window.__logs??=[]).push({level,event,data}); }; L.child=()=>L; export default ()=>L; export const getLogger=()=>L;`],
  [/SchoolDebrief\/schoolDebriefApi\.js$/, `export const createSchoolDebriefApi=()=>window.__debriefApi;`],
  [/runtime\/useSchoolApi\.js$/, `export function useSchoolApi(){return window.__schoolApi;} export function useScopedSchoolClient(){return window.__debriefApi;}`],
  [/shared\/useTakeRecorder\.js$/, `export default function useTakeRecorder(){return {phase:'idle',start(){},stop(){},unavailable:false,verdict:null,stream:null,onLevel(){},release(){},heard:false};}`],
  [/shared\/useInputStall\.js$/, `import {useEffect} from 'react'; export function useInputStall(key,cb){useEffect(()=>{ if(window.__scenario?.nudge) cb(45000); },[key]);} export default useInputStall;`],
];

const PROMPTS = [
  { id: 'classes', text: 'Which classes did you have today?', required: false, kind: 'chips' },
  { id: 'moment', text: 'Tell me about one moment from today. Where were you, who was there, what happened?', required: true, kind: 'text' },
  { id: 'teach', text: "What can you do or know now that you couldn't this morning? Explain it so a younger kid could try it.", required: true, kind: 'text' },
  { id: 'hard', text: 'What was hard, and what did you do about it?', required: false, kind: 'text' },
];
const CLASSES = ['Reading', 'Writing', 'Math', 'Science', 'Social Studies', 'Art', 'Music', 'PE', 'Library', 'Spanish'];
const ALL_ENTRIES = {
  classes: { text: 'Science, Art' },
  moment: { text: 'In cooking club with Mr. Park and Leo we made strawberry jam. We mixed the jam and sugar in a big pot and stirred it for ten minutes, but we put way too much lemon in so it tasted bad and sour and we had to start over.' },
  teach: { text: 'You crush the berries, add sugar, and boil it until a drop on a cold plate wrinkles when you push it.' },
  hard: { text: 'Waiting for it to cool.' },
};
const QUESTIONS = [
  { id: 'q1', kind: 'choice', prompt: 'Why did the first batch of jam taste bad?', options: ['Too much lemon', 'Not enough sugar', 'It burned', 'The berries were green'] },
  { id: 'q2', kind: 'short', prompt: 'How can you tell the jam is ready?' },
];
const day = (extra) => ({ studyDay: '2026-11-20', prompts: PROMPTS, classOptions: CLASSES, late: false, phase: 'answering', entries: {}, answers: {}, next: null, ...extra });

const SCENARIOS = {
  start: { day: day({ phase: 'not-started' }) },
  classes: { day: day({ phase: 'not-started' }), start: true },
  moment: { day: day({ phase: 'answering', entries: { classes: ALL_ENTRIES.classes } }), start: true, nudge: true },
  clarify: { day: day({ phase: 'clarify', entries: ALL_ENTRIES, clarify: { prompt: 'Who taught you the cold-plate trick?' } }), start: true },
  choice: { day: day({ phase: 'answering', entries: ALL_ENTRIES, questions: QUESTIONS, next: { kind: 'question', id: 'q1' } }), start: true, answer: { correct: true, answer: 'Too much lemon' }, click: 'Too much lemon' },
  waiting: { day: day({ phase: 'answering', entries: ALL_ENTRIES }), start: true, hangSubmit: true },
  summary: { day: day({ phase: 'completed', entries: ALL_ENTRIES, summary: { quiz: { right: 2, graded: 2 }, rich: true, teachable: true, levelReason: 'You told who was there, where you cooked, the exact steps…' } }), bank: 'live', silver: 80 },
  'summary-soon-late': { day: day({ phase: 'completed', late: true, entries: { moment: { text: 'We had indoor recess.' } }, summary: { quiz: { right: 1, graded: 2 }, rich: false, teachable: false } }), bank: 'dry-run' },
  rejected: { day: day({ phase: 'rejected' }) },
};

const AVATAR = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#7aa7d9"/><circle cx="80" cy="64" r="34" fill="#f2c9a0"/><rect x="34" y="104" width="92" height="56" rx="28" fill="#d9534f"/></svg>`;

let browser; let js; let css;
beforeAll(async () => {
  const sheets = new Set();
  const esbuild = require('esbuild');
  const bundle = await esbuild.build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';import SchoolDebriefProgram from './SchoolDebriefProgram.jsx';
        const s=window.__scenario;
        window.__root=createRoot(document.querySelector('.school-activity__content'));
        window.__root.render(<SchoolDebriefProgram learnerId="test-learner" learnerName="Ada" debriefGrant="g" lateDay={null} today="2026-11-20" onExit={()=>{window.__exited=true;}} />);`,
      resolveDir: HERE, loader: 'jsx',
    },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.js': 'jsx', '.jsx': 'jsx' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"MODE":"production","DEV":false,"PROD":true}' }, logLevel: 'silent',
    plugins: [{ name: 'io-only', setup(build) {
      build.onResolve({ filter: /\.(scss|css)$/ }, (args) => { const file = args.path.startsWith('.') ? path.resolve(args.resolveDir, args.path) : require.resolve(args.path); sheets.add(file); return { path: file, namespace: 'sheet' }; });
      build.onLoad({ filter: /.*/, namespace: 'sheet' }, () => ({ contents: '', loader: 'js' }));
      build.onLoad({ filter: /\.(jsx|js|mjs)$/ }, (args) => {
        for (const [pattern, contents] of stubs) if (pattern.test(args.path)) return { contents, loader: 'jsx' };
        if (args.path.endsWith('/home/icons/iconRegistry.js')) {
          const dir = path.join(path.dirname(args.path), 'svg');
          const gen = path.join(dir, 'generated');
          const files = [...fs.readdirSync(dir).filter((f) => f.endsWith('.svg')), ...(fs.existsSync(gen) ? fs.readdirSync(gen).filter((f) => f.endsWith('.svg')).map((f) => `generated/${f}`) : [])];
          const assets = Object.fromEntries(files.map((f) => [`./svg/${f}`, fs.readFileSync(path.join(dir, f), 'utf8')]));
          return { contents: fs.readFileSync(args.path, 'utf8').replace(/import\.meta\.glob\([^;]+\)/, JSON.stringify(assets)), loader: 'jsx' };
        }
        return null;
      });
    } }],
  });
  js = bundle.outputFiles[0].text;
  const { dsRootCss } = await import(path.join(ROOT, 'frontend/src/lib/theme/tokens.mjs'));
  const sass = await import('sass-embedded');
  const out = [dsRootCss(), ':root{--ds-accent:#51cf66}']; // the school pack's accent (packs.mjs)
  for (const file of new Set([path.join(ROOT, '__app_modules/learning/school/browser/portal/SchoolPortal.scss'), ...sheets])) {
    out.push(file.endsWith('.css') ? fs.readFileSync(file, 'utf8') : (await sass.compileAsync(file, { loadPaths: [path.join(ROOT, 'frontend'), path.join(ROOT, 'frontend/src'), path.dirname(file)] })).css);
  }
  css = out.join('\n').replace(/@font-face\s*\{[^}]*\}/g, '');
  const { chromium } = await import('playwright');
  browser = await chromium.launch();
  fs.mkdirSync(SHOTS, { recursive: true });
}, 180000);
afterAll(async () => { await browser?.close(); });

async function open(name, { settle = 2600 } = {}) {
  const scenario = SCENARIOS[name];
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('http://debrief.test/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/img/')) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: AVATAR });
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html>' });
  });
  await page.goto('http://debrief.test/');
  await page.setContent(`<style>${css}html,body{margin:0;height:100%;background:var(--ds-background);color:var(--ds-text-high);font-family:Roboto,system-ui,sans-serif}</style>
    <div style="width:1280px;height:800px;display:flex"><section class="school-activity school-activity--focus school-activity--adapter" data-layout="focus"><div class="school-activity__content"></div></section></div>`);
  await page.evaluate((s) => {
    window.__scenario = s;
    const ok = (data) => ({ ok: true, status: 200, data });
    window.__debriefApi = {
      day: async () => ok(s.day), open: async () => ok(s.day),
      entry: async () => ok(s.day), clarify: async () => ok(s.day),
      answer: async () => ok(s.answer), take: async () => ok(null),
      submit: () => (s.hangSubmit ? new Promise(() => {}) : Promise.resolve(ok(s.day))),
      complete: async () => ok(s.day),
    };
    window.__schoolApi = {
      economyBank: async () => ok({ mode: s.bank ?? 'dry-run' }),
      earningsPreview: async () => ok({ totals: { silver: s.silver ?? 0 }, lines: [] }),
    };
  }, scenario);
  await page.addScriptTag({ content: js });
  await page.locator('.sd-panel').waitFor();
  if (scenario.start) await page.locator('.sd-start .ds-touch').first().click();
  if (scenario.click) await page.getByRole('button', { name: new RegExp(scenario.click) }).click();
  // Long enough for the typed lines to finish (TypedText caps a line at 2.2 s).
  await page.waitForTimeout(settle);
  return { page, errors };
}

/** Anything that leaves the screen, the rail or the panel, and a panel that has to scroll. */
async function problems(page) {
  return page.evaluate(() => {
    const out = [];
    const inside = (o, i) => i.left >= o.left - 0.5 && i.right <= o.right + 0.5 && i.top >= o.top - 0.5 && i.bottom <= o.bottom + 0.5;
    const screen = { left: 0, top: 0, right: 1280, bottom: 800 };
    for (const box of ['.sd-rail', '.sd-panel']) {
      const el = document.querySelector(box);
      if (!el) { out.push(`${box} missing`); continue; }
      const r = el.getBoundingClientRect();
      if (!inside(screen, r)) out.push(`${box} leaves the screen`);
      for (const child of el.querySelectorAll('*')) {
        const c = child.getBoundingClientRect();
        if (c.width === 0 && c.height === 0) continue;
        if (!inside(r, c)) out.push(`${box}: ${child.className?.baseVal ?? child.className ?? child.tagName} spills`);
      }
    }
    const panel = document.querySelector('.sd-panel');
    if (panel && panel.scrollHeight > panel.clientHeight + 1) out.push(`panel scrolls (${panel.scrollHeight} > ${panel.clientHeight})`);
    return out;
  });
}

const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

describe('the debrief at 1280x800', () => {
  for (const name of Object.keys(SCENARIOS)) {
    it(`${name}: fits the screen with nothing spilling`, async () => {
      const { page, errors } = await open(name);
      await shot(page, name);
      expect(errors).toEqual([]);
      expect(await problems(page)).toEqual([]);
      await page.close();
    }, 30000);
  }

  it('the rail tracks the step on screen', async () => {
    const { page } = await open('moment');
    const steps = await page.$$eval('.sd-step', (els) => els.map((e) => `${e.querySelector('.sd-step__label').textContent}:${e.className.match(/is-(\w+)/)[1]}`));
    expect(steps).toEqual(['Classes:done', 'A moment:current', 'Teach it:todo', 'What was hard:todo', 'Questions:todo']);
    await page.close();
  }, 30000);

  it('the AI line types itself out behind a cursor, and a key finishes it', async () => {
    const { page } = await open('clarify', { settle: 600 });
    const mid = await page.evaluate(() => {
      const h = document.querySelector('.reflection-response__prompt');
      return { rest: h.querySelector('.typed__rest')?.dataset.rest ?? '', cursor: Boolean(h.querySelector('.typed__cursor')), height: h.getBoundingClientRect().height };
    });
    await shot(page, 'typing');
    expect(mid.rest.length).toBeGreaterThan(0);
    expect(mid.cursor).toBe(true);
    await page.keyboard.press('Shift');
    await page.waitForTimeout(50);
    const after = await page.evaluate(() => {
      const h = document.querySelector('.reflection-response__prompt');
      return { text: h.textContent, rest: Boolean(h.querySelector('.typed__rest')), height: h.getBoundingClientRect().height };
    });
    expect(after.text).toBe('Who taught you the cold-plate trick?');
    expect(after.rest).toBe(false);
    expect(after.height).toBe(mid.height); // the line never reflowed while typing
    await page.close();
  }, 30000);

  it('the summary quotes the child, has one Done and no nudge or Stop', async () => {
    const { page } = await open('summary');
    const text = await page.locator('.sd-program').innerText();
    expect(text).toContain('In cooking club with Mr. Park');
    expect(text).not.toContain('You told who was there');
    expect(await page.getByRole('button', { name: /^Done/ }).count()).toBe(1);
    expect(await page.getByRole('button', { name: /stop for now/i }).count()).toBe(0);
    await page.close();
  }, 30000);
});
