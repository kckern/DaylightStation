/**
 * Shared participant launch contracts. Implementations are injected by composition.
 * Values crossing the store boundary are immutable serializable snapshots.
 *
 * @typedef {{id:string,version:number}} ConsumerRef
 * @typedef {{role:string,id:string,hash:string,version?:number}} ArtifactRef
 * @typedef {{schema:string,data:unknown}} VersionedPayload
 * @typedef {{schema:'participant-prepared-setup/v1',consumer:ConsumerRef,setup:VersionedPayload,artifacts:ArtifactRef[],preview:VersionedPayload,confirmation:'required'|'none'}} PreparedParticipantSetup
 * @typedef {{schema:'participant-launch-snapshot/v1',launch_id:string,consumer:ConsumerRef,action:string,target:object,participant_context:object|null,prepared:PreparedParticipantSetup,setup_hash:string,snapshot_hash:string}} ParticipantLaunchSnapshot
 * @typedef {{provider:string,id:string}} RuntimeRef
 * @typedef {{kind:'content',content_id:string,item_uid?:string}} SafeReturnTarget
 * @typedef {{schema:'participant-launch-result/v1',kind:'ready',launch_id:string,consumer:ConsumerRef,snapshot_hash:string,participant_context:object|null,output:VersionedPayload,runtime_ref?:RuntimeRef,return_to?:SafeReturnTarget}} ReadyResult
 * @typedef {{schema:'participant-launch-result/v1',kind:'resume_available',consumer:ConsumerRef,current_setup_hash:string,choices:Array<{launch_id:string,runtime_ref:RuntimeRef,label:string}>}|{schema:'participant-launch-result/v1',kind:'passthrough',action:string,target:object}|ReadyResult} ParticipantLaunchResult
 * @typedef {{launch_id:string,consumer:ConsumerRef,setup_hash:string,snapshot_hash:string,runtime_ref?:RuntimeRef,result?:ReadyResult}} LaunchReceipt
 * @typedef {{store:IParticipantLaunchStore,scope_key:string}} ParticipantLaunchAccess
 * @typedef {{scopeKey:string,requestId:string,requestDigest:string}} ReservationInput
 * @typedef {{snapshot:Omit<ParticipantLaunchSnapshot,'launch_id'|'snapshot_hash'>,provenance:unknown}} SnapshotBuild
 * @typedef {{kind:'reserved',reused:boolean,snapshot:ParticipantLaunchSnapshot,executionKey:string,result?:ReadyResult}} ReservedLaunch
 * @typedef {{snapshot:ParticipantLaunchSnapshot,receipt:LaunchReceipt,return_to?:SafeReturnTarget}} RetainedLaunch
 * @typedef {{action:string,kind:'app',appId:string}|{action:string,kind:'content',source:string,capability:string}} ActionTargetMatcher
 * @typedef {{participantRequirement:'required'|'optional',minParticipants:number,maxParticipants:number,selectorSupport:string[],settingsSchema:string,editorKey:string}} ParticipantConsumerDescriptor
 * @typedef {{id:string,authorizeAccess:(ref:string,input:{action:string,viewer:unknown})=>Promise<ParticipantLaunchAccess>,resolve:(ref:string,access:{viewer:unknown})=>Promise<{sourceRevision:number,scope:object,roster:object[],selector:object,action:string,target:object,consumer:ConsumerRef,settings:unknown,returnTo:object}>}} IParticipantContextProvider
 * @typedef {{id:string,version:number,targets:ActionTargetMatcher[],describe:(target:object)=>ParticipantConsumerDescriptor,resolveDefaultContext?:(target:object,viewer:unknown)=>Promise<object|null>,prepareSetup:(input:{target:object,participantContext:object|null,settings:unknown,viewer:unknown})=>Promise<PreparedParticipantSetup>,retainPrepared?:(input:{prepared:PreparedParticipantSetup,viewer:unknown})=>Promise<void>,findResumable?:(input:{receipts:readonly LaunchReceipt[],viewer:unknown})=>Promise<Array<{launch_id:string,runtime_ref:RuntimeRef,label:string}>>,resume?:(input:{snapshot:ParticipantLaunchSnapshot,receipt:LaunchReceipt,viewer:unknown})=>Promise<ReadyResult>,begin:(input:{snapshot:ParticipantLaunchSnapshot,executionKey:string,viewer:unknown})=>Promise<ReadyResult>,remapParticipantKeys?:(input:{settings:unknown,keyMap:Record<string,string|null>})=>unknown}} IParticipantConsumer
 * @typedef {{readRetained:(input:{scopeKey:string,launchId:string})=>Promise<RetainedLaunch|null>,inspect:<T>(scopeKey:string,build:(existing:readonly LaunchReceipt[])=>Promise<T>)=>Promise<T>,reserve:(input:ReservationInput,build:(existing:readonly LaunchReceipt[])=>Promise<SnapshotBuild|{reuse_launch_id:string,setup_hash:string}|Extract<ParticipantLaunchResult,{kind:'resume_available'}>>)=>Promise<ReservedLaunch|Extract<ParticipantLaunchResult,{kind:'resume_available'}>>,complete:(input:{scopeKey:string,launchId:string,executionKey:string,snapshotHash:string,result:ReadyResult})=>Promise<ReadyResult>}} IParticipantLaunchStore
 *
 * inspect is read-only. reserve performs idempotency lookup before its callback,
 * and atomically admits snapshot, provenance, request mapping and execution key.
 * complete verifies the key and hash and attaches the result idempotently.
 * A missing receipt result denotes an admitted attempt, not runtime completion.
 */
export {};
