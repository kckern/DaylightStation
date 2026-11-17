/** Exact ownership registrations shared by readers and writers. */
export class AgendaResourceAliases {
  #aliases = new Map();
  #authority;
  constructor({registrations = [], authority = () => false} = {}) {
    if (!Array.isArray(registrations) || typeof authority !== 'function') throw Error('Invalid alias configuration');
    this.#authority=authority;
    for (const entry of registrations) {
      const {kind,id,owner,canonicalContentId,adminUrl}=entry || {};
      if (![kind,id,owner,canonicalContentId,adminUrl].every(value=>typeof value === 'string' && value.length > 0) ||
          owner !== 'agenda' || !/^agenda:[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(canonicalContentId) ||
          !/^\/admin\/content\/agendas\/[A-Za-z0-9_.-]+$/.test(adminUrl) || adminUrl !== `/admin/content/agendas/${canonicalContentId.slice(7)}`) throw Error('Invalid alias registration');
      const key=JSON.stringify([kind,id]);
      if (this.#aliases.has(key)) throw Error('Duplicate alias registration');
      this.#aliases.set(key,Object.freeze({...entry}));
    }
  }
  resolve({kind,id} = {}) {
    const entry=this.#aliases.get(JSON.stringify([kind,id]));
    if (!entry) return null;
    let decision;
    try { decision=this.#authority(entry); } catch (cause) { throw Object.assign(Error('Ownership authority unavailable',{cause}),{code:'ownership_unavailable'}); }
    if (decision !== true && decision !== false) throw Object.assign(Error('Ownership authority unavailable'),{code:'ownership_unavailable'});
    if (!decision) return null;
    const {owner,canonicalContentId,adminUrl}=entry;
    return {owner,canonicalContentId,adminUrl};
  }
}
