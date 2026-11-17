import { workHash, assertWorkUser, workError } from '../domain/workState.mjs';

/** Operator-only job orchestration. Journal import remains inside the Lifelog owner. */
export class WorkBackfillJob {
  #policy;
  #context;
  #files;
  #open;
  #clock;
  #nextId;
  #closed = false;
  #jobs = new Set();
  constructor({
    resolvePolicy,
    context,
    filesFactory,
    knowledgeBridge,
    clock,
    nextId
  }) {
    this.#policy = resolvePolicy;
    this.#context = context;
    this.#files = filesFactory;
    this.#open = knowledgeBridge;
    this.#clock = clock;
    this.#nextId = nextId;
  }
  #active() {
    if (this.#closed) throw workError('WORK_BACKFILL_STOPPED');
  }
  #check(job) {
    this.#active();
    assertWorkUser(job?.username);
    const p = this.#policy(job.username);
    if (!p?.enabled || job.schema !== 'work-backfill-job/v1' || job.manifest?.username !== job.username || job.policyRevision !== p.revision || !Number.isFinite(job.manifest.from) || !Number.isFinite(job.manifest.asOf) || job.manifest.asOf > this.#clock() || job.manifest.asOf - job.manifest.from !== job.days * 86400000 || !Number.isInteger(job.days) || job.days < 1 || job.days > p.limits.backfillMaxDays) throw workError('WORK_BACKFILL_DENIED');
    return p;
  }
  async #using(policy, files, work) {
    this.#active();
    const job = await this.#open.openJob({
      policy,
      checkpoint: files.checkpoint,
      workContext: this.#context,
      verifyPolicy: () => {
        const current = this.#policy(policy.username);
        return !this.#closed && current?.enabled === true && current.revision === policy.revision && current.importWrites === true && current.writer.write === true;
      }
    });
    this.#jobs.add(job);
    try {
      this.#active();
      return await work(job.bridge);
    } finally {
      this.#jobs.delete(job);
      await job.dispose?.();
    }
  }
  async prepare({
    username,
    asOf,
    days = 90,
    outputDir
  }) {
    this.#active();
    assertWorkUser(username);
    const policy = this.#policy(username);
    if (!policy?.enabled || !Number.isInteger(days) || days < 1 || days > policy.limits.backfillMaxDays || !Number.isFinite(asOf) || asOf > this.#clock()) throw workError('WORK_BACKFILL_DENIED');
    const files = this.#files({
      outputDir
    });
    return this.#using(policy, files, async bridge => {
      const prepared = await bridge.prepareImport({
        username,
        from: asOf - days * 86400000,
        asOf,
        jobId: this.#nextId()
      });
      this.#active();
      const job = {
        schema: 'work-backfill-job/v1',
        username,
        days,
        policyRevision: policy.revision,
        manifest: prepared.manifest,
        report: prepared.report
      };
      this.#check(job);
      const manifestPath = files.writeJson({
        name: job.manifest.jobId + '.manifest.json',
        value: job
      });
      return {
        ...job.manifest,
        manifestPath,
        report: job.report
      };
    });
  }
  async preview({
    manifestPath,
    usageDir
  }) {
    const files = this.#files({
        manifestPath
      }),
      job = files.readJson(manifestPath),
      policy = this.#check(job);
    return this.#using(policy, files, async bridge => {
      const result = await bridge.previewImport({
        manifest: job.manifest,
        usageDir
      });
      this.#active();
      this.#check(job);
      const value = {
        schema: 'work-backfill-result/v1',
        jobDigest: workHash(job),
        username: job.username,
        artifact: result.artifact,
        report: result.report
      };
      const artifactPath = files.writeJson({
        name: job.manifest.jobId + '.artifact.json',
        value
      });
      return {
        artifactPath,
        report: result.report,
        checkpoint: result.checkpoint
      };
    });
  }
  async apply({
    manifestPath,
    artifactPath,
    operatorReceipt
  }) {
    const files = this.#files({
        manifestPath
      }),
      job = files.readJson(manifestPath),
      policy = this.#check(job),
      result = files.readJson(artifactPath);
    if (!policy.importWrites || !policy.writer.write || result.schema !== 'work-backfill-result/v1' || result.username !== job.username || result.jobDigest !== workHash(job)) throw workError('WORK_BACKFILL_DENIED');
    return this.#using(policy, files, async bridge => {
      this.#check(job);
      const receipt = operatorReceipt ?? bridge.captureImportReceipt({
        manifest: job.manifest
      });
      return bridge.commitImport({
        manifest: job.manifest,
        artifact: result.artifact,
        operatorReceipt: receipt
      });
    });
  }
  async close() {
    this.#closed = true;
    await Promise.allSettled([...this.#jobs].map(job => job.dispose?.()));
  }
}
