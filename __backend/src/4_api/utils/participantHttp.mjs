/** Shared HTTP boundary for household-scoped participant operations. */
const HOST_ROLES = new Set(['sysadmin', 'parent', 'gaming-host']);
export function httpError(code, message, errors) { return Object.assign(new Error(message), {code, ...(errors ? {errors} : {})}); }
export function viewerFor(req, householdId, host = false) {
  if (!req.user?.sub) throw httpError('authentication_required', 'Authentication required');
  if (typeof householdId !== 'string' || !householdId) throw httpError('feature_unavailable', 'Household scope unavailable');
  if ((req.user.hid && req.user.hid !== householdId) || (req.householdId && req.householdId !== householdId)) throw httpError('authorization_denied', 'Household scope mismatch');
  const roles = [...(req.roles || []), ...(req.user.roles || [])].map(String);
  const viewer = {role: roles.some(role => HOST_ROLES.has(role)) ? 'host' : 'participant', participant_id:String(req.user.sub), householdId};
  if (host && viewer.role !== 'host') throw httpError('authorization_denied', 'Host authority required');
  return viewer;
}
export function bodyFields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError('invalid_request', 'Object required', [{field:'body',message:'Object required'}]);
  const errors=Object.keys(body).filter(key=>!allowed.includes(key)).map(field=>({field,message:'Unknown field'}));
  if (errors.length) throw httpError('invalid_request', 'Unknown fields', errors);
  return body;
}
export function precondition(req) {
  const value=req.get('If-Match');
  if (!value) throw httpError('precondition_required','If-Match required');
  if (!/^"[^"\r\n]+"$/.test(value)) throw httpError('invalid_request','Strong If-Match required',[{field:'If-Match',message:'Strong ETag required'}]);
  return value;
}
const STATUS={source_changed:409,identity_conflict:409,migration_busy:409,resource_moved:409,ownership_unavailable:503,unsupported_downgrade:422,authentication_required:401, authorization_denied:403, not_found:404, launch_not_found:404, revision_conflict:409, idempotency_conflict:409, setup_conflict:409, precondition_required:428, feature_unavailable:503, provider_unavailable:503, consumer_unavailable:503, consumer_version_unavailable:503, launch_store_unavailable:503, participant_discovery_unavailable:503, participant_context_required:422, agenda_not_launchable:409, prepared_artifact_unavailable:503, runtime_unavailable:503};
export function handler(logger, operation, {hideForbidden=false}={}) {
  return async (req,res) => { try { await operation(req,res); } catch (error) {
    const code=error.code || 'internal_error';
    const status=hideForbidden && code==='authorization_denied' ? 404 : STATUS[code] || (code.startsWith('invalid_') || ['past_plan','calendar_locked','series_archived'].includes(code) ? 422 : 500);
    logger?.[status>=500?'error':'warn']?.('participant.http.error',{code,status});
    res.status(status).json({code:status===500?'internal_error':code,message:status>=500?'Service unavailable':error.message,...(error.errors ? {errors:error.errors} : error.field ? {errors:[{field:error.field,message:error.message}]} : {})});
  }};
}
export function installed(value) { if (!value) throw httpError('feature_unavailable','Feature unavailable'); return value; }
export function found(value) { if (!value) throw httpError('not_found','Resource not found'); return value; }
export function sendRecord(res, record, status=200) { res.set('ETag',record.etag); return res.status(status).json(record.document); }
