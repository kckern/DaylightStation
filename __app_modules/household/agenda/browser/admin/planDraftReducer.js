import { applyPlanEdit } from '../../portable/planEdits.mjs';

export function changesBoundTarget(draft, command) {
  if (command.type !== 'update-item' || !draft.activity_settings[command.itemUid]) return false;
  const item = draft.list.sections.flatMap(section => section.items).find(value => value.uid === command.itemUid);
  if (!item) return false;
  return ['open','play','queue','display'].some(action => Object.hasOwn(command.changes, action) && JSON.stringify(item[action]) !== JSON.stringify(command.changes[action]));
}

/** The editor's copy is never persisted until its owner sends an explicit save. */
export function planDraftReducer(state, event) {
  if (event.type === 'load' || event.type === 'saved') {
    return {draft:structuredClone(event.document),baseEtag:event.etag,dirty:false,fieldErrors:[],conflict:false,scope:event.scope ?? state?.scope};
  }
  if (!state) return state;
  if (event.type === 'conflict') return {...state,conflict:true};
  if (event.type === 'errors') return {...state,fieldErrors:event.errors};
  if (event.type === 'rebase') return {...state,baseEtag:event.etag,conflict:false};
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
