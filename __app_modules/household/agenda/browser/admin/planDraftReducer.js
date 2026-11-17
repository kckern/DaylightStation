import { applyPlanEdit } from '../../portable/planEdits.mjs';

export function changesBoundTarget(draft, command) {
  if (command.type !== 'update-item' || !draft.activity_settings[command.itemUid]) return false;
  const item = draft.list.sections.flatMap(section => section.items).find(value => value.uid === command.itemUid);
  if (!item) return false;
  return ['open','play','queue','display'].some(action => Object.hasOwn(command.changes, action) && JSON.stringify(item[action]) !== JSON.stringify(command.changes[action]));
}

function reconcileLifecycle(state, event) {
  const remote=event.document;
  const local=state.draft;
  const identityFields=['plan_id','series_id','household_id','week_of','calendar','seeded_from'];
  const sameIdentity=remote && identityFields.every(field=>JSON.stringify(remote[field])===JSON.stringify(local[field]));
  if (!sameIdentity || typeof event.etag!=='string' || !event.etag || !Number.isSafeInteger(remote.revision) || remote.revision<0 || !['draft','published'].includes(remote.state) ||
      (event.type==='published-with-edits' && remote.state!=='published')) {
    return {...state,conflict:true,fieldErrors:[{field:'plan.state',message:'The saved plan cannot accept these edits. Reload the plan to inspect its current state.'}]};
  }
  const draft={...local,state:remote.state,revision:remote.revision};
  if (Object.hasOwn(remote,'updated_at')) draft.updated_at=remote.updated_at;
  return {...state,draft,baseEtag:event.etag,dirty:true,conflict:false,fieldErrors:[]};
}

/** The editor's copy is never persisted until its owner sends an explicit save. */
export function planDraftReducer(state, event) {
  if (event.type !== 'load' && event.scope && (state?.scope !== event.scope || (event.generation !== undefined && state?.generation !== event.generation))) return state;
  if (event.type === 'load' || event.type === 'saved') {
    return {draft:structuredClone(event.document),baseEtag:event.etag,dirty:false,fieldErrors:[],conflict:false,scope:event.scope ?? state?.scope,generation:event.generation ?? state?.generation};
  }
  if (!state) return state;
  if (event.type === 'conflict') return {...state,conflict:true};
  if (event.type === 'errors') return {...state,fieldErrors:event.errors};
  if (event.type === 'rebase' || event.type === 'published-with-edits') return reconcileLifecycle(state,event);
  if (event.type === 'replace') return {...state,draft:structuredClone(event.document),dirty:true,fieldErrors:[]};
  if (event.type === 'edit') {
    try {
      let draft=state.draft;
      if (changesBoundTarget(draft,event.command)) {
        if (!event.clearChangedBinding) throw Object.assign(new Error('Confirm clearing participant setup for this target change'),{field:`activity_settings.${event.command.itemUid}`});
        draft=structuredClone(draft);
        delete draft.activity_settings[event.command.itemUid];
      }
      return {...state,draft:applyPlanEdit(draft,event.command,event.options),dirty:true,fieldErrors:[]};
    } catch (error) {
      return {...state,fieldErrors:[{field:error.field || 'plan',message:error.message}]};
    }
  }
  return state;
}
