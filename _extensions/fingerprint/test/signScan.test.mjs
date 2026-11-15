import {test} from 'node:test';
import assert from 'node:assert/strict';
import {signScan} from '../src/signScan.mjs';
import {TrustedScannerVerifier} from '../../../__app_modules/wellness/fitness/server/adapters/eventbus/TrustedScannerVerifier.mjs';
test('reader wire envelope verifies in the actual backend and preserves relay fields',()=>{
 const secret='s'.repeat(48),clock={now:()=>100000},verify=new TrustedScannerVerifier({secret,clock});
 const signed=signScan({topic:'biometric.scan',modality:'fingerprint',matched:true,uuid:'stored-template'},{secret,now:clock.now});
 assert.equal(signed.uuid,'stored-template');assert.equal(verify.accept(signed),true);assert.equal(verify.accept(signed),false);
});
