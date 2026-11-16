const fail = () => { throw Object.assign(new Error('Target unavailable'), {code:'invalid_target'}); };

/** Resolve caller input only through registered owner authorities. */
export function createParticipantTargetResolver({apps, resolveContent}) {
  if (!apps || typeof resolveContent !== 'function') throw Error('Target authorities required');
  return async ({target, action, viewer}) => {
    if (!target || typeof target !== 'object' || Array.isArray(target)) return fail();
    if (action === 'open') {
      let appId, path;
      if (target.kind === 'authored-action' && typeof target.value === 'string') {
        const slash=target.value.indexOf('/');
        appId=slash < 0 ? target.value : target.value.slice(0,slash);
        path=slash < 0 ? null : target.value.slice(slash+1);
      } else if (target.kind === 'app') {
        appId=target.appId;
        path=target.definitionId ?? target.path ?? null;
      }
      if (typeof appId !== 'string' || !Object.hasOwn(apps,appId) || typeof apps[appId] !== 'function') return fail();
      return apps[appId]({path,viewer});
    }
    return resolveContent({target,action,viewer});
  };
}

/** Obtain content identity and supported operations from the installed catalog. */
export function createContentTargetResolver({contentIdResolver,contentCatalog,authorize}) {
  if (!contentIdResolver?.resolve || !contentCatalog?.getItem || !contentCatalog?.capabilities || typeof authorize !== 'function') throw Error('Content authority required');
  return async ({target,action,viewer}) => {
    if (!await authorize({target,action,viewer})) throw Object.assign(Error('Content authority required'),{code:'authorization_denied'});
    const value=target?.kind === 'authored-action' ? target.value?.contentId : target?.kind === 'content' ? target.id : null;
    if (typeof value !== 'string' || !value) return fail();
    const resolution=contentIdResolver.resolve(value);
    if (!resolution) return fail();
    const item=await contentCatalog.getItem(resolution);
    if (!item) return fail();
    const capability={play:'playable',queue:'queueable',display:'displayable',list:'listable'}[action];
    const supported=contentCatalog.capabilities(item,resolution);
    if (!capability || !supported.includes(capability)) return fail();
    const descriptor=await contentCatalog.participantActionDescriptor?.(item,resolution,action);
    if (descriptor != null && (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor) || Object.keys(descriptor).some(key=>key !== 'participantConsumer') || !descriptor.participantConsumer || typeof descriptor.participantConsumer.id !== 'string' || !Number.isSafeInteger(descriptor.participantConsumer.version) || descriptor.participantConsumer.version < 1 || Object.keys(descriptor.participantConsumer).sort().join(',') !== 'id,version')) return fail();
    return {kind:'content',source:resolution.source,id:`${resolution.source}:${resolution.localId}`,capabilities:{[capability]:{action,...(descriptor ? {participantConsumer:{...descriptor.participantConsumer}} : {})}}};
  };
}
