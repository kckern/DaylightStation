import {it,expect,vi} from 'vitest';
vi.mock('../../../../__app_modules/household/supervision/browser/index.js',()=>({SupervisedActivity:({children})=>children}));
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

it('renders registered apps with participant props only for the matching consumer',async()=>{
 const React=await import('react');const {render,screen,cleanup}=await import('@testing-library/react');
 const {default:AppContainer}=await import('./AppContainer.jsx');
 const Aware=({participantLaunch,definitionId})=>React.createElement('div',null,`${definitionId}:${participantLaunch?.consumer.id || 'none'}`);
 const Ordinary=({participantLaunch})=>React.createElement('div',null,participantLaunch ? 'unexpected context' : 'ordinary');
 const awareEntry={component:async()=>({default:Aware}),param:{name:'definitionId'},participantLaunch:{consumer:{id:'neutral',version:1},outputSchema:'neutral/v1'}};
 const ordinaryEntry={component:async()=>({default:Ordinary})};
 const registrySpy=vi.spyOn(await import('../../lib/appRegistry.js'),'getApp').mockImplementation(id=>id==='aware'?awareEntry:ordinaryEntry);
 const result={schema:'participant-launch-result/v1',kind:'ready',consumer:{id:'neutral',version:1},output:{schema:'neutral/v1',data:{}}};
 const view=render(React.createElement(AppContainer,{open:'aware/example',participantLaunch:result,clear:()=>{}}));expect(await screen.findByText('example:neutral')).toBeTruthy();
 view.rerender(React.createElement(AppContainer,{open:'ordinary',participantLaunch:result,clear:()=>{}}));expect(await screen.findByText('ordinary')).toBeTruthy();cleanup();registrySpy.mockRestore();
});
