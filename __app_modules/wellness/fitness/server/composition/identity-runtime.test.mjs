import {it,expect,vi} from 'vitest';
import {createFitnessIdentityRuntime} from './identity-runtime.mjs';
import {YamlUserProfileDatastore} from '../../../../../__backend/src/1_adapters/persistence/yaml/YamlUserProfileDatastore.mjs';
import {createMigrationOwnership} from '../../../../household/agenda/server/adapters/MigrationOwnership.mjs';

it('blocks the installed fingerprint writer during an identity migration transition',async()=>{
 const ownership=createMigrationOwnership({householdId:'home'});const save=vi.fn(),refresh=vi.fn();
 class Store extends YamlUserProfileDatastore {constructor(args){super({...args,load:()=>({}),save});}}
 const runtime=await createFitnessIdentityRuntime({eventBus:{broadcast(){},onClientMessage(){}},YamlUserProfileDatastore:Store,configService:{getUserDir:id=>`/users/${id}`,reloadUserProfile:refresh},assertIdentityWritable:ownership.assertSharedWritable});
 await ownership.withTransition(async()=>{await expect(runtime.fingerprintProfileWriter.addFingerprint('person',{id:'fp',finger:'left',enrolled:'now'})).rejects.toMatchObject({code:'migration_busy'});});
 expect(save).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled();
 await runtime.fingerprintProfileWriter.addFingerprint('person',{id:'fp',finger:'left',enrolled:'now'});expect(save).toHaveBeenCalledOnce();expect(refresh).toHaveBeenCalledOnce();
});
