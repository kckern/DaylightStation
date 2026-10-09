import {pathToFileURL} from 'node:url';
import {fixedRunnerSelection} from '../configs/fixed-runner-selection.mjs';
for(const file of fixedRunnerSelection('remaining-node').files)await import(pathToFileURL(file).href);
