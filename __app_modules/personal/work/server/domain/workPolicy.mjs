import {WORK_OPERATIONS} from './workModel.mjs';
/** Routing is necessary, not sufficient: dispatch also checks live adapter capability/role. */
export function routeWork({policy,domainId,operation}){
 if(!policy?.enabled)return {denied:'work_disabled'};
 if(!Object.hasOwn(policy.domains??{},domainId))return {denied:'unconfigured_domain'};
 const domain=policy.domains[domainId],provider=Object.hasOwn(policy.providers??{},domain.provider)?policy.providers[domain.provider]:null;
 if(!provider)return {denied:'unconfigured_provider'};
 if(!WORK_OPERATIONS.includes(operation)||!provider.operations.includes(operation))return {denied:'operation_not_allowed'};
 if(operation!=='read'&&(!policy.writer.write||!policy.providerWrites))return {denied:'provider_writes_disabled'};
 return {provider:provider.type,accountId:provider.accountId,containerId:domain.containerId};
}
