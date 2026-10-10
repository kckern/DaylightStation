/** Called only by the four fixed isolated profiles' Jest entries. No subprocess API. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixedRunnerSelection} from '../configs/fixed-runner-selection.mjs';
import {fixedJestConfig} from '../configs/fixed-jest-config.mjs';
export async function runFixedJest(profile) {
  if(!['main-current-jest','bots-displays-jest','media-content-jest','remaining-jest'].includes(profile))throw new Error('Unknown fixed Jest profile');
  const selection=fixedRunnerSelection(profile);
  const config=fixedJestConfig(profile);
  const jest=await import(pathToFileURL(path.join(selection.toolRoot,'node_modules/jest/build/index.js')).href);
  const runCLI=jest.runCLI??jest.default?.runCLI;
  if(typeof runCLI!=='function')throw new Error('Installed Jest does not expose runCLI');
  const {results}=await runCLI({config:JSON.stringify(config),runInBand:true,runTestsByPath:true,
    _:selection.files,$0:'fixed-isolated-jest',watch:false,watchAll:false,cache:false,json:true,
    outputFile:path.join(selection.scratch,profile+'-result.json')},[selection.root]);
  const actual=results.testResults.map(result=>path.resolve(result.testFilePath)).sort();
  if(JSON.stringify(actual)!==JSON.stringify([...selection.files].sort()))throw new Error('Jest selected population changed');
  if(results.wasInterrupted||!results.success||results.numTotalTestSuites!==selection.files.length||results.numFailedTests||results.numFailedTestSuites||results.numPendingTests||results.numTodoTests||results.numPendingTestSuites)throw new Error('Incomplete or failed fixed Jest profile');
  fs.writeFileSync(path.join(selection.scratch,profile+'-population.json'),JSON.stringify({profile,sourcePopulation:selection.selected,executedFiles:actual,testNames:results.testResults.flatMap(file=>file.testResults.map(test=>test.fullName)).sort()})+'\n');
  process.stdout.write(`FIXED JEST PROFILE PASS ${profile}: ${results.numTotalTestSuites} files, ${results.numTotalTests} tests\n`);
}
