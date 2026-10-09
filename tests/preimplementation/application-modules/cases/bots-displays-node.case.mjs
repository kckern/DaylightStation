/** Retained native node:test cases; do not convert or rename their assertions. */
import {pathToFileURL} from 'node:url';
import {fixedRunnerSelection} from '../configs/fixed-runner-selection.mjs';
for(const file of fixedRunnerSelection('bots-displays-node').files)await import(pathToFileURL(file).href);
