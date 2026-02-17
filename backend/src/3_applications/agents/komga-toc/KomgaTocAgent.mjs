// backend/src/3_applications/agents/komga-toc/KomgaTocAgent.mjs
import { BaseAgent } from '../framework/BaseAgent.mjs';
import { KomgaTocToolFactory } from './tools/KomgaTocToolFactory.mjs';
import { systemPrompt } from './prompts/system.mjs';

export class KomgaTocAgent extends BaseAgent {
  static id = 'komga-toc';
  static description = 'Extracts table-of-contents data from Komga magazine PDFs using AI vision';

  registerTools() {
    this.addToolFactory(new KomgaTocToolFactory(this.deps));
  }

  getSystemPrompt() {
    return systemPrompt;
  }
}
