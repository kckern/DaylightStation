import { validateWorkRef } from '../domain/workModel.mjs';
export const TODOIST_WORK_OPERATIONS = Object.freeze(['read', 'complete', 'reopen', 'create_task', 'update_task', 'delete_task', 'create_container', 'rename_container', 'archive_container']);
const fail = () => {
  throw new TypeError('INVALID_TODOIST_WORK_REQUEST');
};
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 10000;
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(value);
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
/** Closed canonical payload vocabulary; unknown fields never reach the provider. */
export function todoistRequest({
  operation,
  ref,
  payload = {}
}) {
  if (!TODOIST_WORK_OPERATIONS.includes(operation) || !payload || Array.isArray(payload) || typeof payload !== 'object') fail();
  if (ref !== null && ref !== undefined) {
    validateWorkRef(ref);
    if (ref.provider !== 'todoist') fail();
  }
  const container = ['create_container', 'rename_container', 'archive_container'].includes(operation);
  if (!operation.startsWith('create_') && !ref) fail();
  if (ref && ref.kind !== (container ? 'container' : operation === 'read' ? ref.kind : 'task')) fail();
  const fields = {
    create_task: ['title', 'description', 'containerId', 'dueDate', 'assigneeId'],
    update_task: ['title', 'description', 'dueDate', 'assigneeId'],
    create_container: ['title', 'parentId'],
    rename_container: ['title']
  }[operation] ?? [];
  if (Object.keys(payload).some(key => !fields.includes(key))) fail();
  if (operation.startsWith('create_') && !text(payload.title) || operation === 'rename_container' && !text(payload.title) || operation === 'update_task' && !Object.keys(payload).length) fail();
  if (payload.title !== undefined && !text(payload.title) || payload.description !== undefined && (typeof payload.description !== 'string' || payload.description.length > 16384) || payload.dueDate !== undefined && payload.dueDate !== null && !date(payload.dueDate) || payload.containerId !== undefined && !opaque(payload.containerId) || payload.parentId !== undefined && !opaque(payload.parentId) || payload.assigneeId !== undefined && !opaque(payload.assigneeId)) fail();
  if (operation === 'create_task' && !opaque(payload.containerId) || operation === 'create_container' && !opaque(payload.parentId)) fail();
  const body = {};
  for (const [key, wire] of Object.entries({
    title: container ? 'name' : 'content',
    description: 'description',
    containerId: 'project_id',
    dueDate: 'due_date',
    assigneeId: 'assignee_id',
    parentId: 'parent_id'
  })) if (Object.hasOwn(payload, key)) body[wire] = payload[key];
  // A null due date clears it; the REST API clears through due_string.
  if (operation === 'update_task' && payload.dueDate === null) { delete body.due_date; body.due_string = 'no date'; }
  const family = container || ref?.kind === 'container' ? 'projects' : 'tasks';
  const suffix = {
    complete: '/close',
    reopen: '/reopen',
    archive_container: '/archive'
  }[operation] ?? '';
  return {
    method: operation === 'read' ? 'GET' : operation === 'delete_task' ? 'DELETE' : 'POST',
    path: `/${family}${operation.startsWith('create_') ? '' : `/${encodeURIComponent(ref.id)}`}${suffix}`,
    body
  };
}
/** Auth and HTTP only. No retry: the command owner records uncertain mutations. */
export class TodoistWorkClient {
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
    if (typeof httpClient?.requestRaw !== 'function' || typeof getUserAuth !== 'function' || typeof clock !== 'function') throw new TypeError('Todoist work transport dependencies required');
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
    const request = todoistRequest({
      operation,
      ref,
      payload
    });
    if (typeof username !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(username)) fail();
    const auth = await this.#auth('todoist', username);
    if (!text(auth?.api_key)) throw new Error('TODOIST_AUTH_UNAVAILABLE');
    if (request.method !== 'GET' && (!(await authorizeSend(this.#clock())) || this.#canSend({
      username
    }) !== true)) throw new Error('WORK_SEND_REVOKED');
    const response = await this.#http.requestRaw(request.method, `https://api.todoist.com/api/v1${request.path}`, {
      ...(request.method === 'POST' ? {
        body: request.body
      } : {}),
      headers: {
        Authorization: `Bearer ${auth.api_key}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
    const header = response.headers?.get?.('retry-after') ?? response.headers?.['retry-after'];
    const retry = typeof header === 'string' && /^\d+$/.test(header) ? this.#clock() + Number(header) * 1000 : typeof header === 'string' ? Date.parse(header) : null;
    return {
      status: response.status,
      ok: response.ok === true,
      data: response.data ?? null,
      retryAfter: Number.isFinite(retry) && retry >= this.#clock() ? retry : null
    };
  }
}
