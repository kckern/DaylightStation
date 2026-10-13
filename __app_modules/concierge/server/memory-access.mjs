export async function createConciergeMemoryAccess({ dataService }) {
    const { YamlWorkingMemoryAdapter } = await import("../../../__capabilities/agent-runtime/server/adapters/YamlWorkingMemoryAdapter.mjs");
    const { WorkingMemoryRepository } = await import("../../../__capabilities/agent-runtime/server/application/framework/WorkingMemoryRepository.mjs");
    const { ConciergeMemoryService } = await import("./application/ConciergeMemoryService.mjs");
    const recordStore = new YamlWorkingMemoryAdapter({ dataService });
    const workingMemory = new WorkingMemoryRepository({ recordStore });
    const memory = new ConciergeMemoryService({ workingMemory });
    // Stash the working memory so `dscli memory list` can dump all keys via
    // wm.load('concierge', 'household').then(state => state.getAll()).
    memory.__workingMemory = workingMemory;
    return memory;
}
