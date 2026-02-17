// backend/src/3_applications/agents/paged-media-toc/PagedMediaTocAgent.mjs
import { BaseAgent } from '../framework/BaseAgent.mjs';
import { PagedMediaTocToolFactory } from './tools/PagedMediaTocToolFactory.mjs';
import { systemPrompt } from './prompts/system.mjs';

export class PagedMediaTocAgent extends BaseAgent {
  static id = 'paged-media-toc';
  static description = 'Extracts table-of-contents data from paged media (magazines, comics) using AI vision';

  registerTools() {
    this.addToolFactory(new PagedMediaTocToolFactory(this.deps));
  }

  getSystemPrompt() {
    return systemPrompt;
  }
}
