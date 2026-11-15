import {it,expect} from 'vitest';
import {createHmac} from 'node:crypto';
import {TrustedScannerVerifier} from '../../../../__app_modules/wellness/fitness/server/adapters/eventbus/TrustedScannerVerifier.mjs';
it('only fresh signed scanner events can become adult intervention proofs',()=>{
 const secret='s'.repeat(48),clock={now:()=>100000},verify=new TrustedScannerVerifier({secret,clock});
 const data={modality:'fingerprint',matched:true,uuid:'registered-fingerprint'};
 const message={topic:'biometric.scan',...data,scanner:{id:'garage-reader',at:100000,nonce:'unique-scan-1'}};
 const sign=value=>createHmac('sha256',secret).update(JSON.stringify({topic:value.topic,data:{modality:value.modality,matched:value.matched,uuid:value.uuid??null},scanner:value.scanner})).digest('hex');
 message.signature=sign(message);expect(verify.accept({...message,signature:'bad'})).toBe(false);expect(verify.accept(message)).toBe(true);expect(verify.accept(message)).toBe(false);
 const tampered={...message,uuid:'user_9',scanner:{...message.scanner,nonce:'unique-scan-2'}};expect(verify.accept(tampered)).toBe(false);
 const stale={...message,scanner:{...message.scanner,nonce:'unique-scan-3',at:90000}};stale.signature=sign(stale);expect(verify.accept(stale)).toBe(false);
 expect(verify.accept({topic:'biometric.scan',data})).toBe(false);
});
it('scanner diagnostics distinguish missing configuration, rejected signatures and actual verified scans without exposing a UUID or nonce',async()=>{
 const {createTrustedParentalScanner}=await import('../../../../__app_modules/wellness/fitness/server/composition/supervision.mjs');
 const missing=createTrustedParentalScanner({credentials:{},clock:{now:()=>100000}});expect(missing.health()).toMatchObject({configured:false,lastVerifiedAt:null});
 const verifier=new TrustedScannerVerifier({secret:'s'.repeat(48),clock:{now:()=>100000}});verifier.accept({topic:'biometric.scan'});expect(verifier.health()).toMatchObject({configured:true,lastVerifiedAt:null,lastRejection:{reason:'INVALID_ENVELOPE',at:100000}});expect(JSON.stringify(verifier.health())).not.toContain('nonce');
});
