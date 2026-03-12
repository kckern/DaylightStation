import path from 'path';
import fs from 'fs';
import { loadYamlSafe, saveYaml, ensureDir } from '#system/utils/FileIO.mjs';

/**
 * YAML-backed conversation history for agents.
 * Implements IMemoryDatastore port.
 *
 * Storage: {basePath}/{agentId}/conversations/{conversationId}.yml
 */
export class YamlConversationStore {
  #basePath;

  constructor({ basePath }) {
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
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  async listConversations(agentId) {
    const dir = path.join(this.#basePath, agentId, 'conversations');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.yml'))
      .map(f => f.replace('.yml', ''));
  }

  #filePath(agentId, conversationId) {
    return path.join(this.#basePath, agentId, 'conversations', `${conversationId}.yml`);
  }
}
