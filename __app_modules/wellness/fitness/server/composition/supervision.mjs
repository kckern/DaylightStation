import {TrustedScannerVerifier} from '../adapters/eventbus/TrustedScannerVerifier.mjs';
export function createTrustedParentalScanner({credentials,clock,scannerId}){
  const verifier=credentials?.scanner_secret?new TrustedScannerVerifier({secret:credentials.scanner_secret,clock,id:scannerId??'garage-reader'}):null;
  const verify=message=>verifier?.accept(message)===true;verify.health=()=>verifier?.health()??{configured:false,protocol:1,lastVerifiedAt:null,verifiedScans:0,lastRejection:null};return verify;
}
