/** Retained native node:test cases; do not convert or rename their assertions. */
import fs from 'node:fs';
import {after} from 'node:test';
import {installGamingScratchFsAdapter} from '../tooling/gaming-scratch-fs.mjs';
import {pathToFileURL} from 'node:url';
import {fixedRunnerSelection} from '../configs/fixed-runner-selection.mjs';
const fixture=installGamingScratchFsAdapter({scratchRoot:process.env.PRE_RUN_ROOT});
after(()=>{fs.writeFileSync(process.env.PRE_RUN_ROOT+'/gaming-fs-adapter.json',JSON.stringify(fixture.controls));fixture.restore();});
for(const file of fixedRunnerSelection('gaming-notation-node').files)await import(pathToFileURL(file).href);
