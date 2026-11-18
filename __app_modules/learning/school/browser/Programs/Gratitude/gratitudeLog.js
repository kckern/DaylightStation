import getLogger from '../../../../../../frontend/src/lib/logging/Logger.js';
import { currentInput } from '../shared/inputVia.js';
let logger;
const emit=(name,data={},level='info')=>{logger??=getLogger().child({component:'school-gratitude'});logger[level](`school.gratitude.ui.${name}`,{...data,input:currentInput()});};
export const gratitudeLog=Object.fromEntries(['mounted','unmounted','takeStart','transcribing','takeKept','closed','takeRefused','submit','stall','followUpShown','apiRejected','apiFailed'].map(name=>[name,data=>emit(name,data,name.startsWith('api')?'warn':'info')]));
