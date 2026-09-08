/** Reconcile Appendix-A contracts with actual router registrations and composed mounts. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {packet,emit} from './census.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=n=>JSON.parse(fs.readFileSync(path.join(packet,n)));
const contracts=read('contracts.json'), api=read('api-registration-audit.json');
const routes=contracts.contracts.filter(c=>c.id.startsWith('CTR-GR-HTTP-')).sort((a,b)=>a.line-b.line);
const endpoints=api.endpoints.filter(e=>e.source.path==='backend/src/4_api/v1/routers/gratitude.mjs').sort((a,b)=>a.registrationOrder-b.registrationOrder);
const rows=routes.map((route,index)=>{const endpoint=endpoints[index];return {id:route.id,method:route.method,localPattern:route.pattern.replace('/api/v1/gratitude',''),fullPattern:route.pattern,source:{path:route.source,line:route.line},registrationOrder:endpoint?.registrationOrder,composedMount:endpoint?.appMount,parents:endpoint?.parentMounts,implicitHead:true,optionalExpansion:route.id==='CTR-GR-HTTP-18'?['/card/print','/card/print/:location']:[],middleware:route.middleware,errorTranslation:'async handlers pass unhandled errors to app-level errorHandlerMiddleware; explicit route 400/404/409/501 responses remain route-owned'};});
const issues=rows.filter((row,i)=>!endpoints[i]||row.registrationOrder!==i||row.composedMount?.anchor!=="app.use('/api/v1', apiRouter)"||row.parents?.[0]?.pattern!=='/gratitude');
emit('gratitude-route-seed-review.json',{schema:'daylight.preimplementation.gratitude-route-seed/v1',inventoryInputs:['contracts.json','api-registration-audit.json'].map(name=>({name,sha256:hash(fs.readFileSync(path.join(packet,name)))})),summary:{routes:rows.length,composedBase:'/api/v1/gratitude',obsoleteCommentPrefix:'/api/gratitude',optionalLocationExpansions:2,passed:rows.length===18&&endpoints.length===18&&!issues.length},rows,issues,notes:['Router source comments use /api/gratitude and are not route authority.','Implicit HEAD is Express behavior; OPTIONS/CORS are parent/app middleware behavior, not additional Gratitude registrations.'],toolHash:hash(fs.readFileSync(new URL(import.meta.url)))});
process.stdout.write(JSON.stringify({routes:rows.length,endpoints:endpoints.length,issues:issues.length})+'\n');
