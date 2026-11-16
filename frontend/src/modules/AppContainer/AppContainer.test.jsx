import {it,expect} from 'vitest';
import {parseAppInput} from './AppContainer.jsx';
it('preserves the complete app parameter after the first slash',()=>{
 expect(parseAppInput('fake/one/two')).toEqual({app:'fake',param:'one/two'});
});

it('only supplies participant props to an explicitly matching app registration',async()=>{
 const {participantPropsForApp}=await import('./AppContainer.jsx');
 const result={schema:'participant-launch-result/v1',kind:'ready',consumer:{id:'neutral',version:1},output:{schema:'neutral/v1',data:{}}};
 expect(participantPropsForApp({},result)).toEqual({});
 expect(participantPropsForApp({participantLaunch:{consumer:{id:'neutral',version:1},outputSchema:'neutral/v1'}},result)).toEqual({participantLaunch:result});
 expect(participantPropsForApp({participantLaunch:{consumer:{id:'neutral',version:2},outputSchema:'neutral/v1'}},result)).toEqual({});
});
