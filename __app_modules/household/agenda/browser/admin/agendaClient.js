import { buildHeaders } from '../../../../../frontend/src/lib/api.mjs';

const encode = value => encodeURIComponent(value);
const base = '/api/v1/admin/content/agendas';

export function createAgendaClient(fetcher = fetch) {
  async function request(path, {method='GET',body,etag}={}) {
    const headers = buildHeaders(localStorage.getItem('ds_token'), body !== undefined);
    if (etag != null) headers['If-Match'] = etag;
    const response = await fetcher(path,{method,headers,...(body !== undefined ? {body:JSON.stringify(body)} : {})});
    const document = await response.json();
    if (!response.ok) throw Object.assign(new Error(document.message || 'Request failed'),document,{status:response.status});
    return {document,etag:response.headers.get('ETag')};
  }
  const seriesPath = id => `${base}/${encode(id)}`;
  const planPath = (id,planId) => `${seriesPath(id)}/plans/${encode(planId)}`;
  return {
    seriesList:()=>request(base),
    series:id=>request(seriesPath(id)),
    saveSeries:(id,series,etag)=>request(seriesPath(id),{method:'PUT',body:{series},etag}),
    resolveArtwork:(id,itemUids)=>request(`${seriesPath(id)}/artwork/resolve`,{method:'POST',body:{itemUids}}),
    defaultsArtwork:id=>request(`${seriesPath(id)}/defaults/artwork`),
    planningContext:id=>request(`${seriesPath(id)}/planning-context`),
    plans:id=>request(`${seriesPath(id)}/plans`),
    plan:(id,planId)=>request(planPath(id,planId)),
    createPlan:(id,input)=>request(`${seriesPath(id)}/plans`,{method:'POST',body:input}),
    savePlan:(id,planId,plan,etag)=>request(planPath(id,planId),{method:'PUT',body:{plan},etag}),
    transition:(id,planId,action,etag)=>request(`${planPath(id,planId)}/${encode(action)}`,{method:'POST',body:{},etag}),
    people:()=>request('/api/v1/admin/people?includeArchived=true'),
    createGuest:(guest,etag)=>request('/api/v1/admin/people/guests',{method:'POST',body:guest,etag}),
    updateGuest:(id,guest,etag)=>request(`/api/v1/admin/people/guests/${encode(id)}`,{method:'PUT',body:guest,etag}),
    archiveGuest:(id,etag)=>request(`/api/v1/admin/people/guests/${encode(id)}/archive`,{method:'POST',body:{},etag}),
    describe:(target,action)=>request('/api/v1/participant-launches/describe',{method:'POST',body:{target,action}}),
  };
}
export const agendaClient = createAgendaClient((...args) => fetch(...args));
