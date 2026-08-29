/** Semantic source of hardware input events for application ingress workflows. */
export class IEventInputSource {
  observe(_handler) { throw new Error('observe must be implemented'); }
}

export default IEventInputSource;
