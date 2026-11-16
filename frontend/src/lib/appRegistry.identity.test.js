import {it,expect} from 'vitest';
import {APP_REGISTRY} from './appRegistry.js';
import {SCREEN_APP_IDS} from '../../../__capabilities/screen-host/portable/appIds.mjs';
it('keeps server app authority declarations aligned with installed screen apps',()=>{
 expect([...SCREEN_APP_IDS].sort()).toEqual(Object.keys(APP_REGISTRY).sort());
});
