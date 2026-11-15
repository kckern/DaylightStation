/** Synchronous transforms only: model/network work can never hold this boundary. */
export async function mutateKnowledge({ store, username, runId, build }) {
  for (let attempt=0; attempt<5; attempt++) {
    const snapshot = await store.read({username});
    if (!snapshot.health.available) throw Object.assign(new Error('Knowledge unavailable'),{code:'KNOWLEDGE_UNAVAILABLE'});
    const batch = build(snapshot);
    if (batch?.then) throw new TypeError('Knowledge mutation transform must be synchronous');
    if (!batch) return {snapshot,batch:null,applied:false};
    try {
      const result = await store.commit({username,expectedRevision:snapshot.revision,runId,batch});
      return {snapshot,batch,...result};
    } catch (error) { if (error.code !== 'STALE_KNOWLEDGE_REVISION' || attempt===4) throw error; }
  }
}
export const stateBatch = (statePatch,events=[]) => ({events,upserts:[],moves:[],statePatch,previewOnly:false});
