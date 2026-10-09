/** Existing Jest/Babel semantics, exact oracle files, no root test setup. */
import fs from 'node:fs';
import path from 'node:path';
import {fixedRunnerSelection} from './fixed-runner-selection.mjs';
export function fixedJestConfig(profile) {
  if(!['bots-displays-jest','media-content-jest','remaining-jest'].includes(profile))throw new Error('Unknown fixed Jest profile');
  const {root,files,scratch,toolRoot}=fixedRunnerSelection(profile);
  if(JSON.parse(fs.readFileSync(path.join(toolRoot,'node_modules/jest/package.json'),'utf8')).version!=='29.7.0')throw new Error('Reviewed Jest 29.7.0 required');
  const imports=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).imports;
  const moduleNameMapper={'^jimp$':path.join(toolRoot,'node_modules/jimp/dist/commonjs/index.js')};
  for(const [alias,target] of Object.entries(imports)){
    if(typeof target!=='string'||!alias.endsWith('/*')||!target.endsWith('/*'))throw new Error('Unsupported package alias in fixed Jest config');
    const pattern='^'+alias.slice(0,-1).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(.*)$';
    moduleNameMapper[pattern]=path.resolve(root,target.slice(0,-1))+'/$1';
  }
  return {
    rootDir:root,roots:[...new Set(files.map(file=>path.dirname(file)))],testMatch:files,testEnvironment:path.join(toolRoot,'node_modules/jest-environment-node'),
    setupFiles:[],setupFilesAfterEnv:[],cache:false,cacheDirectory:path.join(scratch,profile+'-cache'),
    transform:{'^.+\\.m?[tj]s$':[path.join(toolRoot,'node_modules/babel-jest'),{configFile:path.join(root,'babel.config.js'),babelrc:false}]},
    moduleNameMapper,moduleFileExtensions:['js','mjs','json','node'],
    transformIgnorePatterns:['/node_modules/(?!(zod|node-fetch|data-uri-to-buffer|fetch-blob|formdata-polyfill|music-metadata|strtok3|peek-readable|token-types)/)'],
    testPathIgnorePatterns:['/node_modules/'],collectCoverage:false,
  };
}
