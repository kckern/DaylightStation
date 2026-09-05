/** Framework-neutral, persisted workflow lifecycle. Definitions are trusted code;
 * all inputs, outputs, resume data and stored state are plain JSON.
 */
export class IAgentRunRuntime {
  register(_definition) { throw new Error('register not implemented'); }
  async start(_request) { throw new Error('start not implemented'); }
  async get(_request) { throw new Error('get not implemented'); }
  async resume(_request) { throw new Error('resume not implemented'); }
  async cancel(_request) { throw new Error('cancel not implemented'); }
  async recover(_request) { throw new Error('recover not implemented'); }
}
