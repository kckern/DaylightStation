// Disposable Jeopardy authority: real repositories, no household services.
import fs from 'node:fs';
import YAML from 'yaml';
import {createDurableGamingFixture} from './createDurableGamingFixture.mjs';
import {jeopardyRuleModule} from '../../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs';

export async function createDurableJeopardyFixture({clock,definition=null,definitionId='jeopardy:test'}={}){
 const source=definition||YAML.parse(fs.readFileSync(new URL('../_fixtures/group-play/jeremiah-open-book.yml',import.meta.url),'utf8'));
 const manifest={id:'jeopardy',version:1,hash:'b'.repeat(64),setup:{kind:'teams',host_modes:['human']},surfaces:[{id:'party-games',presenter:'jeopardy-board',authority_modes:['remote']}]};
 return createDurableGamingFixture({clock,definition:{rule_module:{id:'jeopardy',version:1},experience:{id:'jeopardy',version:1},...source},definitionId,rulesets:[jeopardyRuleModule],manifest});
}
