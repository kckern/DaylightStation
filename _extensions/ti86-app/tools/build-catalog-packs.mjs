#!/usr/bin/env node
/** Compile mounted shared School Catalog lessons into direct TI-86 String files. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { YamlLearningCatalogRepository } from '../../../backend/src/1_adapters/school/catalog/YamlLearningCatalogRepository.mjs';
import { YamlLearningContentRepository } from '../../../backend/src/1_adapters/school/catalog/YamlLearningContentRepository.mjs';
import { Ti86SchoolCalcCodec } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { BuildLearningLesson } from '../../../backend/src/3_applications/school/catalog/BuildLearningLesson.mjs';
import { listCatalogLessons, validateLearningCatalog } from '../../../backend/src/2_domains/school/catalog/index.mjs';
import { createTi86StringFile } from './lib/ti86-string-file.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const DEFAULT_ROOT = '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/content/school/catalog';
const rootIndex = process.argv.indexOf('--content-root');
const contentRoot = path.resolve(rootIndex === -1 ? DEFAULT_ROOT : process.argv[rootIndex + 1] ?? '');
const outputIndex = process.argv.indexOf('--output');
const outputDirectory = path.resolve(outputIndex === -1
  ? path.join(EXTENSION, 'dist', 'content-packs') : process.argv[outputIndex + 1] ?? '');
const sourcesPath = path.join(contentRoot, 'schoolcalc-content-sources.yml');
const configuredBankDirectories = readQuestionBankDirectories(sourcesPath);

const catalogs = new YamlLearningCatalogRepository({ directories: [path.join(contentRoot, 'catalogs')] });
const content = new YamlLearningContentRepository({
  documentDirectories: [path.join(contentRoot, 'documents')],
  bankDirectories: configuredBankDirectories.map((directory) => path.resolve(contentRoot, directory)),
});
const lessons = new BuildLearningLesson({ catalogs, content });
const codec = new Ti86SchoolCalcCodec();
const artifacts = [];
const variableNames = new Set();

for (const { catalogId } of await catalogs.listCatalogs()) {
  const raw = await catalogs.getCatalog(catalogId);
  const checked = validateLearningCatalog(raw);
  if (checked.errors.length) throw new Error(`Invalid Catalog '${catalogId}': ${checked.errors.join('; ')}`);
  for (const { context } of listCatalogLessons(checked.catalog)) {
    // Sequential output preserves authors' catalog order and makes the release manifest stable.
    // eslint-disable-next-line no-await-in-loop
    const bundle = await lessons.execute(context);
    const artifact = codec.compile(bundle);
    if (variableNames.has(artifact.variableName)) throw new Error(`TI-86 variable collision: ${artifact.variableName}`);
    variableNames.add(artifact.variableName);
    artifacts.push({ ...artifact, fileName: `${artifact.variableName}.86s` });
  }
}

mkdirSync(outputDirectory, { recursive: true });
for (const artifact of artifacts) {
  writeFileSync(path.join(outputDirectory, artifact.fileName), createTi86StringFile({
    name: artifact.variableName, record: artifact.bytes,
    comment: `SchoolCalc ${artifact.source.lessonId}`,
  }));
}
const manifest = {
  schema: 'school.calc.ti86-pack-manifest/v1', contentRoot,
  artifactCount: artifacts.length,
  artifacts: artifacts.map(({ bytes, ...artifact }) => artifact),
};
writeFileSync(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
for (const artifact of artifacts) {
  process.stdout.write(`[ti86] ${artifact.fileName} ${artifact.byteLength} bytes ${artifact.source.address}\n`);
}

function readQuestionBankDirectories(filePath) {
  if (!existsSync(filePath)) return ['question-banks'];
  const value = yaml.load(readFileSync(filePath, 'utf8'));
  if (!value || value.schema !== 'school.calc.content-sources/v1'
      || !Array.isArray(value.questionBankDirectories)
      || value.questionBankDirectories.length === 0
      || !value.questionBankDirectories.every((entry) => typeof entry === 'string' && entry.trim())) {
    throw new Error(`${filePath} must declare non-empty questionBankDirectories`);
  }
  return value.questionBankDirectories;
}
