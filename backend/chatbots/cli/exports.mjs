/**
 * CLI Module Exports
 * @module cli
 */

// Main components
export { CLIChatSimulator } from './CLIChatSimulator.mjs';
export { CLIPresenter } from './presenters/CLIPresenter.mjs';
export { CLIInputHandler, InputType } from './input/CLIInputHandler.mjs';
export { CLIMessagingGateway } from './adapters/CLIMessagingGateway.mjs';
export { CLIImageHandler } from './media/CLIImageHandler.mjs';
export { CLISessionManager } from './session/CLISessionManager.mjs';

// Mock adapters
export {
  MockAIGateway,
  MockUPCGateway,
  MockReportRenderer,
  MemoryNutrilogRepository,
  MemoryNutrilistRepository,
  MemoryConversationStateStore,
  MemoryJournalEntryRepository,
  MemoryMessageQueueRepository,
} from './mocks/index.mjs';
