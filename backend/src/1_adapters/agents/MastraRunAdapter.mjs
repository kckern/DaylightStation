import { Mastra } from '@mastra/core/mastra';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { LibSQLStore } from '@mastra/libsql';
import { IAgentRunRuntime } from '#apps/agents/ports/IAgentRunRuntime.mjs';
import { standardSchema } from './standardSchema.mjs';
import { ensureDir } from '#system/utils/FileIO.mjs';
import path from 'node:path';

const objectSchema = { type: 'object', additionalProperties: true };
const fail = message => { throw Object.assign(new Error(message), { status: 404 }); };

/** Durable checkpoints, not a new scheduler. The caller decides what to recover. */
export class MastraRunAdapter extends IAgentRunRuntime {
  #mastra; #workflows = new Map(); #active = new Map();
  constructor({ dbPath, storage }) {
    super();
    if (!storage && dbPath !== ':memory:') ensureDir(path.dirname(dbPath));
    this.#mastra = new Mastra({ logger: false,
      storage: storage || new LibSQLStore({ id: 'agent-runs', url: dbPath === ':memory:' ? dbPath : 'file:' + dbPath }) });
  }
  register({ id, inputSchema = objectSchema, outputSchema = objectSchema, resumeSchema = objectSchema, execute }) {
    const step = createStep({
      id: 'execute', inputSchema: standardSchema(inputSchema), outputSchema: standardSchema(outputSchema),
      resumeSchema: standardSchema(resumeSchema), suspendSchema: standardSchema(objectSchema),
      execute: async ({ inputData, resumeData, suspend, abortSignal, runId, resourceId }) => {
        const result = await execute(inputData, { userId: resourceId, runId, signal: abortSignal, resumeData });
        if (result?.status === 'waiting') return await suspend(result.interaction);
        return result;
      },
    });
    const workflow = createWorkflow({ id, inputSchema: standardSchema(inputSchema), outputSchema: standardSchema(outputSchema),
      options: { shouldPersistSnapshot: () => true } }).then(step).commit();
    this.#mastra.addWorkflow(workflow);
    this.#workflows.set(id, workflow);
  }
  #workflow(id) { return this.#workflows.get(id) || fail('Workflow not found'); }
  async get({ workflowId, userId, runId }) {
    const state = await this.#workflow(workflowId).getWorkflowRunById(runId);
    if (!state || state.resourceId !== userId) fail('Run not found');
    return state;
  }
  #key(workflowId, runId) { return JSON.stringify([workflowId, runId]); }
  async #drive(workflowId, run, action, userId) {
    const key = this.#key(workflowId, run.runId);
    if (this.#active.has(key)) {
      const active = this.#active.get(key);
      if (active.userId !== userId) fail('Run not found');
      return active.promise;
    }
    const promise = action();
    this.#active.set(key, { run, promise, userId });
    try { return await promise; } finally { this.#active.delete(key); }
  }
  async start({ workflowId, userId, runId, input }) {
    if (!userId || !runId) throw new Error('Managed runs require owner and run ID');
    const workflow = this.#workflow(workflowId);
    const state = await workflow.getWorkflowRunById(runId);
    if (state) {
      if (state.resourceId !== userId) fail('Run not found');
      if (state.payload && JSON.stringify(state.payload) !== JSON.stringify(input)) throw Object.assign(new Error('Run ID already used for different input'), { status: 409 });
      if (state.status === 'success') return { status: 'success', result: state.result };
      if (state.status !== 'pending') return this.recover({ workflowId, userId, runId });
    }
    const run = await workflow.createRun({ runId, resourceId: userId });
    return this.#drive(workflowId, run, () => run.start({ inputData: input }), userId);
  }
  async resume({ workflowId, userId, runId, data }) {
    const state = await this.get({ workflowId, userId, runId });
    if (state.status !== 'suspended') throw Object.assign(new Error('Run is not waiting for input'), { status: 409 });
    const run = await this.#workflow(workflowId).createRun({ runId, resourceId: userId });
    return this.#drive(workflowId, run, () => run.resume({ step: 'execute', resumeData: data }), userId);
  }
  async cancel(request) {
    await this.get(request);
    const run = this.#active.get(this.#key(request.workflowId, request.runId))?.run
      || await this.#workflow(request.workflowId).createRun({ runId: request.runId, resourceId: request.userId });
    await run.cancel();
  }
  async recover(request) {
    const state = await this.get(request);
    if (!['running', 'failed', 'pending'].includes(state.status)) return { status: state.status, result: state.result };
    const run = await this.#workflow(request.workflowId).createRun({ runId: request.runId, resourceId: request.userId });
    // restart() resumes active checkpoints; a failed terminal step must be
    // explicitly re-entered. Keep its persisted input, owner and run ID.
    return this.#drive(request.workflowId, run, () => state.status === 'failed'
      ? run.timeTravel({ step: 'execute', inputData: state.payload }) : run.restart(), request.userId);
  }
}
