/** Source-reviewed outer route bindings; no browser/controller startup. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {root, packet, emit} from './census.mjs';
const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const source = read('source-ledger.json'), review = read('registration-review.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inputs = new Set(review.browserRoutes.map(r => r.path));
const sourceText = file => { inputs.add(file); return fs.readFileSync(path.join(root, file), 'utf8'); };
const pianoFile = 'frontend/src/Apps/PianoApp.jsx';
assert.ok(sourceText(pianoFile).includes('const single = pianos.length === 1;'));
assert.ok(sourceText(pianoFile).includes('basePathProp ?? `/piano/${pianoId}`'));
const piano = [{base: '/piano', when: 'roster loaded and pianos.length === 1'},
  {base: '/piano/:pianoId', when: 'roster loaded and pianos.length !== 1; explicit selected ID route'}];
const bases = {
  'frontend/src/Apps/AdminApp.jsx': [{base: '/admin', when: 'main /admin/*'},
    {base: '/', when: 'main exact / only; not an unrestricted Admin-child prefix', exactOnly: true}],
  'frontend/src/Apps/FeedApp.jsx': [{base: '/feed', when: 'main /feed/*'}],
  'frontend/src/Apps/HealthApp.jsx': [{base: '/health', when: 'main /health/* or exact /health'}],
  'frontend/src/Apps/LifeApp.jsx': [{base: '/life', when: 'main /life/*'}],
};
const modeRoot = 'frontend/src/modules/Piano/PianoKiosk/modes/';
const modes = {Exercises: 'exercises', Games: 'games', Music: 'music', SheetMusic: 'sheetmusic',
  Studio: 'studio', Videos: 'videos'};
const redirectsFile = 'frontend/src/routeRedirects.jsx';
sourceText(redirectsFile);
const teacherShell = 'frontend/src/modules/School/teacher/TeacherConsole.jsx';
sourceText(teacherShell);
for (const name of ['Singalong', 'Playalong'])
  assert.ok(sourceText(modeRoot + name + '/' + name + '.jsx').includes('Karaoke'));
const routes = review.browserRoutes.map(r => {
  let contexts;
  if (r.path === 'frontend/src/main.jsx') contexts = [{base: '', when: 'main route'}];
  else if (r.path === pianoFile) {
    if (r.owningFunction === 'PianoShell') contexts = piano;
    else if (r.owningFunction === 'PianoRoutes') contexts = [{base: '/piano',
      when: r.localPattern === '/*' ? 'single piano branch' : 'non-single piano branch'}];
    else throw new Error('Unreviewed Piano route function ' + r.owningFunction);
  } else if (bases[r.path]) contexts = bases[r.path];
  else if (r.path.startsWith(modeRoot)) {
    const mode = r.path.slice(modeRoot.length).split('/')[0];
    const subpaths = mode === 'Karaoke' ? ['playalong', 'singalong'] : [modes[mode]];
    assert.ok(subpaths.every(Boolean), 'Unreviewed mode ' + mode);
    contexts = piano.flatMap(p => subpaths.map(s => ({base: p.base + '/' + s, when: p.when})));
  } else throw new Error('Unreviewed browser route file ' + r.path);
  const patterns = r.finitePatterns.length ? r.finitePatterns : r.index || !('path' in r.attributes) ? [''] : [];
  assert.ok(patterns.length, 'Unresolved path ' + r.id);
  const resolved = contexts.flatMap(context => {
    const parent = review.browserRoutes.find(parent => parent.id === r.parents.at(-1))?.fullPattern || '';
    return patterns.filter(p => !context.exactOnly || p === '' || p === '*').map(pattern => ({
      fullPattern: context.exactOnly ? '/' : [context.base, parent, pattern].join('/').replace(/\/+/g, '/').replace(/\/$/, '') || '/',
      when: context.when, role: !('path' in r.attributes) && !r.index ? 'layout, not an independent endpoint' : 'route',
      declarationId: r.id}));
  });
  return {id: r.id, path: r.path, line: r.line, owningFunction: r.owningFunction,
    index: r.index, element: r.attributes.element, bindings: resolved,
    state: 'source-reviewed pattern/outer binding; actual rendering/auth/data behavior not executed'};
});
const teacher = 'frontend/src/modules/School/teacher/teacherUrl.js';
const school = 'frontend/src/modules/School/schoolPathModel.js';
const schoolShell = 'frontend/src/modules/School/SchoolApp.jsx';
sourceText(teacher); sourceText(school); sourceText(schoolShell);
const manualRouters = [{id: 'BROWSER-MANUAL-TEACHER', source: teacher,
  installedBy: teacherShell, bases: ['/school/teacher'],
  patterns: ['', '/dashboard', '/queue', '/operations', '/curriculum', '/curriculum/:courseId',
    '/curriculum/:courseId/lessons/:lessonId', '/sessions/:sessionId', '/students/:learnerId',
    '/students/:learnerId/day', '/students/:learnerId/day/:studyDay', '/students/:learnerId/courses',
    '/students/:learnerId/courses/:courseId', '/students/:learnerId/history',
    '/students/:learnerId/history/sessions/:sessionId', '/students/:learnerId/reports',
    '/students/:learnerId/operations', '/students/:learnerId/overview'],
  constraints: ['studyDay checks YYYY-MM-DD syntax, not calendar validity',
    'overview parses then shell redirects to learner root', 'extra/unknown segments produce not-found',
    'decode failures retain original segment; source model, not stricter URL validation']},
{id: 'BROWSER-MANUAL-SCHOOL', source: school, installedBy: schoolShell,
  bases: ['/app/school', '/screen/:screenId', '/screens/:screenId'],
  patterns: ['', '/subject/:subjectId/*', '/library/*', '/catalog', '/progress', '/practice', '/print',
    '/typing', '/geography', '/chess', '/rubiks-cube', '/sentence-ladder-preview/:payload', '/launch-preview/:payload'],
  constraints: ['screen bases only when configured content actually installs School',
    'unknown segments return empty selection; sentence-ladder writer path deliberately does not restore a learner launch',
    'material chains preserve their existing source-prefix/encoding rules',
    'no grant/learner authority inferred from a URL; preserve current in-memory-only authority']}];
const mediaParams = 'frontend/src/modules/Media/lib/urlParams.js';
const mediaCanvas = 'frontend/src/modules/Media/shell/Canvas.jsx';
const mediaNav = 'frontend/src/modules/Media/shell/NavProvider.jsx';
sourceText(mediaParams); sourceText(mediaNav);
const mediaViews = [...sourceText(mediaCanvas).matchAll(/case '([^']+)'/g)].map(m => m[1]);
manualRouters.push({id: 'BROWSER-MANUAL-MEDIA', source: mediaParams, installedBy: mediaNav,
  bases: ['/media'], patterns: ['?view=<view>&path=<path>&contentId=<id>&deviceId=<id>'],
  views: mediaViews, viewAuthority: mediaCanvas,
  constraints: ['one pathname; these are query/history state views, not additional JSX routes',
    'home is default; unknown view renders HomeView',
    'nav writer changes only view/path/contentId/deviceId, preserving play/queue/shuffle/shader/volume and other query keys',
    'history.state.mediaNavStack can retain richer in-memory state than the URL; do not flatten it']});
const redirects = [{name: 'OfficeRedirect', from: ['/office', '/office/*'], to: '/screen/office', query: 'deliberately dropped'},
  {name: 'TVRedirect', from: ['/tv', '/tv/*'], to: '/screen/living-room', query: 'preserved; suffix path discarded'},
  {name: 'SchoolDeepLinkRedirect', from: ['/school', '/school/*'], to: '/app/school + original suffix', query: 'preserved'},
  {name: 'TeacherNextRedirect', from: ['/school/teacher-next', '/school/teacher-next/*'], to: '/school/teacher + original suffix', query: 'preserved'}]
  .map(r => ({...r, source: redirectsFile, precedence: 'teacher static routes outrank the School splat'}));
assert.equal(routes.length, 134);
assert.ok(routes.some(r => r.bindings.some(b => b.fullPattern === '/admin/apps/:appId')));
assert.ok(!routes.some(r => r.bindings.some(b => b.fullPattern === '/apps/:appId')));
assert.equal(routes.filter(r => r.path.endsWith('/Karaoke.jsx')).flatMap(r => r.bindings).length, 8);
emit('assembled-browser.json', {schema: 'daylight.preimplementation.assembled-browser/v1', baseline: source.baseline,
  routes, manualRouters, redirects, imperativeNavigation: review.imperativeNavigation,
  limits: ['Source assembly only; auth/setup/config conditions can prevent rendering',
    '134 JSX declarations are not 134 unique URLs; layouts, aliases and conditional roots retained',
    'Imperative history writers are separately indexed and not inferred to create app registrations',
    'Runtime parity for redirects/manual parsers and product state is a later contract-case gate'],
  inputs: [...inputs].sort().map(file => ({path: file, sha256: hash(fs.readFileSync(path.join(root, file)))})),
  inventoryInputs: [{name: 'registration-review.json', sha256: hash(fs.readFileSync(path.join(packet, 'registration-review.json')))}],
  toolHash: hash(fs.readFileSync(new URL(import.meta.url)))});
process.stdout.write(JSON.stringify({declarations: routes.length,
  patternBindings: routes.reduce((n, r) => n + r.bindings.length, 0), manualRouters: manualRouters.length,
  redirects: redirects.length, historyWriters: review.imperativeNavigation.length}) + '\n');
