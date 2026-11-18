import { validateWorkRef } from '../domain/workModel.mjs';
export const CLICKUP_WORK_OPERATIONS = Object.freeze(['read', 'transition', 'complete', 'reopen', 'create_task', 'update_task', 'archive_task', 'delete_task', 'create_container', 'rename_container']);
const invalid = () => {
  throw new TypeError('INVALID_CLICKUP_WORK_REQUEST');
};
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(value);
const title = value => typeof value === 'string' && value.trim() && value.length <= 2000;
export function clickUpRequest({
  operation,
  ref,
  payload = {}
}) {
  if (!CLICKUP_WORK_OPERATIONS.includes(operation) || !payload || typeof payload !== 'object' || Array.isArray(payload)) invalid();
  if (ref) {
    validateWorkRef(ref);
    if (ref.provider !== 'clickup') invalid();
  }
  const create = operation.startsWith('create_'),
    container = operation.endsWith('_container');
  if (!create && !ref || ref && operation !== 'read' && ref.kind !== (container ? 'container' : 'task')) invalid();
  const fields = {
    read: ['nativeKind'],
    transition: ['status'],
    complete: ['status'],
    reopen: ['status'],
    create_task: ['title', 'description', 'containerId', 'assigneeIds'],
    update_task: ['title', 'description'],
    create_container: ['title', 'parentId'],
    rename_container: ['title']
  }[operation] ?? [];
  if (Object.keys(payload).some(k => !fields.includes(k))) invalid();
  if ((create || operation === 'rename_container') && !title(payload.title) || payload.title !== undefined && !title(payload.title) || payload.description !== undefined && (typeof payload.description !== 'string' || payload.description.length > 16384) || operation === 'update_task' && !Object.keys(payload).length) invalid();
  if (['transition', 'complete', 'reopen'].includes(operation) && !title(payload.status)) invalid();
  if (operation === 'create_task' && !opaque(payload.containerId) || operation === 'create_container' && !opaque(payload.parentId)) invalid();
  if (payload.assigneeIds !== undefined && (!Array.isArray(payload.assigneeIds) || !payload.assigneeIds.every(id => typeof id === 'string' && /^\d+$/.test(id) && Number.isSafeInteger(Number(id))))) invalid();
  if (payload.nativeKind !== undefined && !(operation === 'read' && ref.kind === 'container' && payload.nativeKind === 'folder')) invalid();
  const method = operation === 'read' ? 'GET' : operation === 'delete_task' ? 'DELETE' : create ? 'POST' : 'PUT';
  const path = operation === 'create_task' ? `/list/${encodeURIComponent(payload.containerId)}/task` : operation === 'create_container' ? `/folder/${encodeURIComponent(payload.parentId)}/list` : `/${ref.kind === 'task' ? 'task' : payload.nativeKind === 'folder' ? 'folder' : 'list'}/${encodeURIComponent(ref.id)}`;
  const body = {};
  for (const [key, wire] of Object.entries({
    title: 'name',
    description: 'description',
    status: 'status'
  })) if (Object.hasOwn(payload, key)) body[wire] = payload[key];
  if (operation === 'archive_task') body.archived = true;
  if (operation === 'create_task') {
    body.check_required_custom_fields = true;
    if (payload.assigneeIds) body.assignees = payload.assigneeIds.map(Number);
  }
  return {
    method,
    path,
    body
  };
}
/** The injected per-user resolver selects exactly one configured auth scope; no fallback. */
export class ClickUpWorkClient {
  #http;
  #auth;
  #clock;
  #canSend;
  constructor({
    httpClient,
    getUserAuth,
    clock,
    canSend = () => true
  }) {
    if (typeof httpClient?.requestRaw !== 'function' || typeof getUserAuth !== 'function' || typeof clock !== 'function') throw new TypeError('ClickUp work transport dependencies required');
    this.#http = httpClient;
    this.#auth = getUserAuth;
    this.#clock = clock;
    this.#canSend = canSend;
  }
  async request({
    username,
    operation,
    ref,
    payload,
    authorizeSend = async () => true
  }) {
    const request = clickUpRequest({
      operation,
      ref,
      payload
    });
    if (typeof username !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(username)) invalid();
    const auth = await this.#auth('clickup', username);
    if (typeof auth?.api_key !== 'string' || !auth.api_key || !opaque(auth.workspace_id)) throw new Error('CLICKUP_AUTH_UNAVAILABLE');
    const headers = {
      Authorization: auth.api_key,
      'Content-Type': 'application/json'
    };
    if (request.method !== 'GET' && (!(await authorizeSend(this.#clock())) || this.#canSend({
      username
    }) !== true)) throw new Error('WORK_SEND_REVOKED');
    const response = await this.#http.requestRaw(request.method, `https://api.clickup.com/api/v2${request.path}`, {
      headers,
      ...(['POST', 'PUT'].includes(request.method) ? {
        body: request.body
      } : {}),
      timeout: 15000
    });
    if (operation === 'read' && response.ok) {
      const row = response.data;
      if (!row || row.id !== ref.id) throw new Error('CLICKUP_REF_MISMATCH');
      if (ref.kind === 'task') {
        if (String(row.team_id ?? '') !== auth.workspace_id) throw new Error('CLICKUP_WORKSPACE_MISMATCH');
      } else {
        if (typeof row.space?.id !== 'string') throw new Error('CLICKUP_WORKSPACE_UNKNOWN');
        const spaces = await this.#http.requestRaw('GET', `https://api.clickup.com/api/v2/team/${encodeURIComponent(auth.workspace_id)}/space`, {
          headers,
          timeout: 15000
        });
        if (!spaces.ok || !Array.isArray(spaces.data?.spaces) || !spaces.data.spaces.some(space => space.id === row.space.id)) throw new Error('CLICKUP_WORKSPACE_MISMATCH');
      }
    }
    const header = response.headers?.get?.('retry-after') ?? response.headers?.['retry-after'];
    const retry = typeof header === 'string' && /^\d+$/.test(header) ? this.#clock() + Number(header) * 1000 : typeof header === 'string' ? Date.parse(header) : null;
    return {
      ok: response.ok === true,
      status: response.status,
      data: response.data ?? null,
      retryAfter: Number.isFinite(retry) && retry >= this.#clock() ? retry : null
    };
  }
}
