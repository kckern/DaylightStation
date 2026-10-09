import { ObservationalMemory } from '@mastra/memory/processors';

/** Adapter-side construction of Mastra memory processors. */
export class MastraMemoryProcessorFactory {
  createObservationalProcessor({
    memory,
    observerModel = 'google/gemini-2.5-flash',
    reflectorModel = 'google/gemini-2.5-flash',
    messageTokens = 30000,
    observationTokens = 40000,
    scope = 'resource',
  }) {
    const storage = memory?.storage?.stores?.memory ?? null;
    if (!storage) return null;
    return new ObservationalMemory({
      storage,
      observation: { model: observerModel, messageTokens },
      reflection: { model: reflectorModel, observationTokens },
      scope,
    });
  }
}

export default MastraMemoryProcessorFactory;
