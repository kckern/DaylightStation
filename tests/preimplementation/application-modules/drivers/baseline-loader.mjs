/** Test-only dependency-scope bridge. Not proof of future package resolution. */
import { createRequire, builtinModules } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const root = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');
const toolRoot = process.env.PRE_TOOLCHAIN_ROOT;
const browser = process.env.PRE_PACK === 'browser';
const frontendRequire = browser ? createRequire(path.join(toolRoot, 'frontend/package.json')) : null;
const browserPorts = pathToFileURL(path.join(root, 'tests/preimplementation/application-modules/drivers/browser-ports.mjs')).href;
const fakeBrowserSources = new Set(['frontend/src/services/WebSocketService.js', 'frontend/src/lib/logging/Logger.js', 'frontend/src/lib/logging/singleton.js']);
if (!toolRoot || !process.env.PRE_RUN_ROOT) throw new Error('Explicit toolchain and isolated run root required');
const forbidden = new Set(['backend/index.js', 'backend/src/app.mjs', 'backend/src/5_composition/bootstrap.mjs']);
const mutations = {
  'missing-mount': {
    file: 'backend/src/4_api/v1/routers/api.mjs',
    before: "'/gratitude': 'gratitude'",
    after: "'/gratitude-removed': 'gratitude'"
  },
  'changed-response': {
    file: 'backend/src/4_api/v1/routers/gratitude.mjs',
    before: 'marked: selectionIds.length,',
    after: 'marked: selectionIds.length + 1,'
  },
  'changed-storage': {
    file: 'backend/src/1_adapters/persistence/yaml/YamlGratitudeDatastore.mjs',
    before: 'printed: selection.printed',
    after: 'printHistory: selection.printed'
  },
  'failed-print-marks': {
    file: 'backend/src/4_api/v1/routers/gratitude.mjs',
    before: 'if (success && selectedIds) {',
    after: 'if (selectedIds) {'
  },
  'duplicate-event': {
    file: 'backend/src/3_applications/events/RealtimePublications.mjs',
    before: 'this.publish(payload);',
    after: 'this.publish(payload); this.publish(payload);'
  },
  'missing-cleanup': {
    file: 'backend/src/1_adapters/hardware/thermal-printer/TemporaryImagePrintGateway.mjs',
    before: 'deleteFile(temporaryPath);',
    after: 'void temporaryPath;'
  },
  'missing-asset': {
    file: 'backend/src/1_rendering/gratitude/gratitudeCardTheme.mjs',
    before: "fontPath: 'roboto-condensed/RobotoCondensed-Regular.ttf'",
    after: "fontPath: 'missing-audit-font.ttf'"
  }
};
if (process.env.PRE_MUTATION && !mutations[process.env.PRE_MUTATION]) throw new Error('Unknown controlled mutation');
export async function resolve(specifier, context, nextResolve) {
  if(process.env.PRE_VITEST_MODE==='default-discover'){
    const absolute=specifier.startsWith('file:')?fileURLToPath(specifier):specifier;
    for(const scope of ['frontend/','backend/','']){
      const prefix=root+'/'+scope+'node_modules/';
      if(absolute.startsWith(prefix))return {url:pathToFileURL(path.join(toolRoot,scope,'node_modules',absolute.slice(prefix.length))).href,shortCircuit:true};
    }
  }
  if (browser && context.parentURL?.startsWith('file:')) {
    const parent = fileURLToPath(context.parentURL);
    let local = specifier.startsWith('@/') ? path.join(root, 'frontend/src', specifier.slice(2)) : specifier.startsWith('.') ? path.resolve(path.dirname(parent), specifier) : null;
    if (local && local.startsWith(root + '/frontend/')) {
      local = [local, local + '.js', local + '.jsx', local + '.mjs'].find(p => fs.existsSync(p));
      if (local) return {
        url: fakeBrowserSources.has(path.relative(root, local)) ? browserPorts : pathToFileURL(local).href,
        shortCircuit: true
      };
    }
  }
  if (specifier.startsWith('.') || specifier.startsWith('#') || specifier.startsWith('file:')) {
    const result = await nextResolve(specifier, context);
    if (result.url.startsWith('file:') && forbidden.has(path.relative(root, fileURLToPath(result.url)))) throw new Error('UNSAFE_ENTRYPOINT_REFUSED');
    return result;
  }
  if (builtinModules.includes(specifier) || specifier.startsWith('node:')) return nextResolve(specifier, context);
  const parent = context.parentURL?.startsWith('file:') ? fileURLToPath(context.parentURL) : '';
  if (parent.startsWith(root + '/')) {
    const scope = parent.startsWith(root + '/backend/') ? 'backend' : parent.startsWith(root + '/frontend/') || browser && (specifier.startsWith('react') || specifier.startsWith('@testing-library/') || specifier.startsWith('@mantine/')) ? 'frontend' : '';
    const target = createRequire(path.join(toolRoot, scope, 'package.json')).resolve(specifier);
    return {
      url: pathToFileURL(target).href,
      shortCircuit: true
    };
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  const local = url.startsWith('file:') ? fileURLToPath(url) : null;
  if (browser && local?.startsWith(root + '/frontend/') && /\.(scss|css|svg)$/.test(local)) {
    if (!fs.existsSync(local)) throw new Error('MISSING_BROWSER_ASSET');
    return {
      format: 'module',
      source: 'export default ' + JSON.stringify('/synthetic-assets/' + path.basename(local)) + ';',
      shortCircuit: true
    };
  }
  const jsx = browser && local?.startsWith(root + '/frontend/') && local.endsWith('.jsx');
  let result = jsx ? {
    format: 'module',
    source: fs.readFileSync(local, 'utf8'),
    shortCircuit: true
  } : await nextLoad(url, context);
  const mutation = mutations[process.env.PRE_MUTATION];
  if (mutation && url.startsWith('file:') && path.relative(root, fileURLToPath(url)) === mutation.file) {
    const source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString();
    if (source.split(mutation.before).length !== 2) throw new Error('MUTATION_SETUP_MISMATCH');
    process.stderr.write(JSON.stringify({
      controlledMutation: process.env.PRE_MUTATION,
      source: mutation.file
    }) + '\n');
    result = {
      ...result,
      source: source.replace(mutation.before, mutation.after)
    };
  }
  if (jsx) {
    const ts = frontendRequire('typescript');
    result = {
      ...result,
      source: ts.transpileModule(result.source, {
        fileName: local,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          jsx: ts.JsxEmit.ReactJSX,
          allowJs: true,
          verbatimModuleSyntax: true
        }
      }).outputText
    };
  }
  return result;
}
