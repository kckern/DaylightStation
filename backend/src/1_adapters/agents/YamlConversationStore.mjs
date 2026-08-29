import path from 'path';
import { deleteFile, fileExists, listFiles, loadYamlSafe, saveYaml, ensureDir } from '#system/utils/FileIO.mjs';
import { IMemoryDatastore } from '#apps/agents/ports/IMemoryDatastore.mjs';

/**
 * YAML-backed conversation history for agents.
 * Implements IMemoryDatastore port.
 *
 * Storage: {basePath}/{agentId}/conversations/{conversationId}.yml
 */
export class YamlConversationStore extends IMemoryDatastore {
  #basePath;

  constructor({ basePath }) {
    super();
    this.#basePath = basePath;
  }

  async getConversation(agentId, conversationId) {
    const filePath = this.#filePath(agentId, conversationId);
    const data = loadYamlSafe(filePath);
    return Array.isArray(data) ? data : [];
  }

  async saveMessage(agentId, conversationId, message) {
    const filePath = this.#filePath(agentId, conversationId);
    ensureDir(path.dirname(filePath));
    const messages = await this.getConversation(agentId, conversationId);
    messages.push({
      ...message,
      timestamp: message.timestamp || new Date().toISOString(),
    });
    saveYaml(filePath, messages);
  }

  async clearConversation(agentId, conversationId) {
    const filePath = this.#filePath(agentId, conversationId);
    if (fileExists(filePath)) deleteFile(filePath);
  }

  async listConversations(agentId) {
    const dir = path.join(this.#basePath, agentId, 'conversations');
    return listFiles(dir)
      .filter(f => f.endsWith('.yml'))
      .map(f => f.replace('.yml', ''));
  }

  #filePath(agentId, conversationId) {
    return path.join(this.#basePath, agentId, 'conversations', `${conversationId}.yml`);
  }
}
