import {it,expect} from 'vitest';
import {resolveKnowledgeConfig} from './KnowledgeConfig.mjs';
const context={environment:'fixture-prod',hostId:'fixture-host',platform:'linux'};
const writer={enabled:true,write:true,writer_env:'fixture-prod',writer_host:'fixture-host'};
it('defaults to disabled without requiring runtime identity or a timezone',()=>{
 const result=resolveKnowledgeConfig({configuration:{},...context});expect(result.active).toBe(false);expect(result.config).toMatchObject({enabled:false,write:false,writer_env:null,writer_host:null,timezone:null,max_runs_per_day:4,post_entry_minutes:15,min_entry_chars:200,echo_enabled:true,echo_min_chars:600,sweep_at:'03:30',quiz_max:5,quiz_expiry_days:7,ab_days:14});
});
it('requires exact writer environment and host plus Linux before participation',()=>{
 expect(resolveKnowledgeConfig({configuration:writer,...context}).active).toBe(true);
 for(const over of [{environment:'dev'},{hostId:'laptop'},{platform:'darwin'}])expect(resolveKnowledgeConfig({configuration:writer,...context,...over}).active).toBe(false);
 expect(resolveKnowledgeConfig({configuration:{enabled:true,write:true},...context}).active).toBe(false);
});
it.each([{post_entry_minutes:0},{sweep_at:'25:99'},{max_runs_per_day:5},{quiz_max:6},{echo_enabled:'yes'},{timezone:'Not/AZone'},{timezone:{}},{timezone:123}])('disables invalid enabled configuration without throwing: %o',over=>{
 const result=resolveKnowledgeConfig({configuration:{...writer,...over},...context});expect(result.active).toBe(false);expect(result.reason).toBe('invalid_configuration');
});
