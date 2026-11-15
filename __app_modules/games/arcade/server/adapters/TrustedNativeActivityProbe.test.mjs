import {it,expect} from 'vitest';
import {TrustedNativeActivityProbe} from './TrustedNativeActivityProbe.mjs';
it('uses a live process and the last emulator load, never the HTTP observation ledger or old log cache',async()=>{
 let output='42\n42 (retroarch) '+Array(19).fill('0').join(' ')+' 1000\n20.00 0.00\n100\n100000\nretroarch__2026_11_14__12_00_00.log\n99995\n[INFO] Loading content file: "/roms/mario.gb"\nOPEN';
 // stat field 22 is index 19 after comm (field 3 onward).
 output=output.replace(Array(19).fill('0').join(' ')+' 1000',Array(19).fill('0').join(' ')+' 1000');
 const probe=new TrustedNativeActivityProbe({adbAdapter:{shellArgv:async()=>({ok:true,output})},packageName:'com.retroarch',logDir:'/logs',clock:{now:()=>100000},resolveContent:path=>path==='/roms/mario.gb'?{contentId:'arcade:gb/mario'}:null});
 expect(await probe.observe()).toMatchObject({state:'running',contentId:'arcade:gb/mario',observedAt:100000});
 output=output.replace('/roms/mario.gb','/roms/other.gb');expect((await probe.observe()).state).toBe('unknown');output='IDLE';expect((await probe.observe()).state).toBe('idle');
});
it('a previous-process log and failed device commands provide no title proof',async()=>{
 let output='42\n42 (retroarch) '+Array(19).fill('0').join(' ')+' 1000\n20.00 0\n100\n100000\nretroarch__2026_11_14__12_00_00.log\n90000\nLoading content file: "/roms/mario.gb"\nOPEN';
 const probe=new TrustedNativeActivityProbe({adbAdapter:{shellArgv:async()=>({ok:true,output})},packageName:'com.retroarch',logDir:'/logs',clock:{now:()=>100000},resolveContent:()=>({contentId:'arcade:gb/mario'})});expect((await probe.observe()).state).toBe('unknown');
});
