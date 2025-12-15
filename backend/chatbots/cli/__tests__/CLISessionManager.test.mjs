/**
 * CLI Session Manager Tests
 * @module cli/__tests__/CLISessionManager.test
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import { CLISessionManager } from '../session/CLISessionManager.mjs';

describe('CLISessionManager', () => {
  let session;
  const testSessionDir = '/tmp/chatbot-cli-test/sessions';

  beforeEach(async () => {
    session = new CLISessionManager({
      sessionName: 'test-session',
      sessionDir: testSessionDir,
    });
    
    // Clean up test directory
    try {
      await fs.rm(testSessionDir, { recursive: true });
    } catch {
      // Directory may not exist
    }
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testSessionDir, { recursive: true });
    } catch {
      // Ignore
    }
  });

  describe('initialization', () => {
    it('should create session with provided name', () => {
      expect(session.getSessionId()).toBe('test-session');
    });

    it('should generate session ID if not provided', () => {
      const autoSession = new CLISessionManager({});
      expect(autoSession.getSessionId()).toMatch(/^cli-\d+$/);
    });

    it('should initialize successfully', async () => {
      await session.initialize();
      
      // Verify directory was created
      const stat = await fs.stat(testSessionDir);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('bot management', () => {
    it('should start with no bot selected', () => {
      expect(session.getCurrentBot()).toBeNull();
    });

    it('should set and get current bot', () => {
      session.setCurrentBot('nutribot');
      expect(session.getCurrentBot()).toBe('nutribot');
    });

    it('should generate conversation ID with bot name', () => {
      session.setCurrentBot('nutribot');
      const convId = session.getConversationId();
      expect(convId).toBe('cli:nutribot:test-session');
    });
  });

  describe('user ID', () => {
    it('should return CLI user ID', () => {
      expect(session.getUserId()).toBe('cli-user');
    });
  });

  describe('debug mode', () => {
    it('should start with debug disabled by default', () => {
      expect(session.isDebugMode()).toBe(false);
    });

    it('should toggle debug mode', () => {
      expect(session.toggleDebugMode()).toBe(true);
      expect(session.isDebugMode()).toBe(true);
      
      expect(session.toggleDebugMode()).toBe(false);
      expect(session.isDebugMode()).toBe(false);
    });

    it('should respect initial debug setting', () => {
      const debugSession = new CLISessionManager({ debug: true });
      expect(debugSession.isDebugMode()).toBe(true);
    });
  });

  describe('conversation history', () => {
    it('should start with empty history', () => {
      expect(session.getHistory()).toHaveLength(0);
    });

    it('should add messages to history', () => {
      session.addToHistory({ role: 'user', content: 'hello' });
      session.addToHistory({ role: 'bot', content: 'hi' });
      
      const history = session.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].content).toBe('hello');
      expect(history[1].content).toBe('hi');
    });

    it('should add timestamp to messages', () => {
      session.addToHistory({ role: 'user', content: 'test' });
      
      const history = session.getHistory();
      expect(history[0].timestamp).toBeDefined();
    });

    it('should limit history to last 100 messages', () => {
      for (let i = 0; i < 110; i++) {
        session.addToHistory({ role: 'user', content: `message ${i}` });
      }
      
      const history = session.getHistory(150);
      expect(history.length).toBeLessThanOrEqual(100);
    });

    it('should clear history', () => {
      session.addToHistory({ role: 'user', content: 'test' });
      session.clearHistory();
      
      expect(session.getHistory()).toHaveLength(0);
    });
  });

  describe('bot state', () => {
    beforeEach(() => {
      session.setCurrentBot('nutribot');
    });

    it('should start with empty bot state', () => {
      expect(session.getBotState()).toEqual({});
    });

    it('should set bot state', () => {
      session.setBotState({ flow: 'confirmation', logId: '123' });
      
      expect(session.getBotState()).toEqual({ 
        flow: 'confirmation', 
        logId: '123' 
      });
    });

    it('should update bot state', () => {
      session.setBotState({ flow: 'confirmation' });
      session.updateBotState({ logId: '123' });
      
      expect(session.getBotState()).toEqual({ 
        flow: 'confirmation', 
        logId: '123' 
      });
    });

    it('should maintain separate state per bot', () => {
      session.setBotState({ nutribot: 'state' });
      
      session.setCurrentBot('journalist');
      session.setBotState({ journalist: 'state' });
      
      session.setCurrentBot('nutribot');
      expect(session.getBotState()).toEqual({ nutribot: 'state' });
      
      session.setCurrentBot('journalist');
      expect(session.getBotState()).toEqual({ journalist: 'state' });
    });
  });

  describe('persistence', () => {
    it('should persist session to file', async () => {
      await session.initialize();
      
      session.setCurrentBot('nutribot');
      session.addToHistory({ role: 'user', content: 'test' });
      
      await session.persist();
      
      // Verify file exists
      const sessionFile = path.join(testSessionDir, 'test-session.json');
      const stat = await fs.stat(sessionFile);
      expect(stat.isFile()).toBe(true);
    });

    it('should load persisted session', async () => {
      await session.initialize();
      
      session.setCurrentBot('nutribot');
      session.addToHistory({ role: 'user', content: 'persisted message' });
      
      await session.persist();
      
      // Create new session with same name
      const newSession = new CLISessionManager({
        sessionName: 'test-session',
        sessionDir: testSessionDir,
      });
      await newSession.initialize();
      
      expect(newSession.getCurrentBot()).toBe('nutribot');
      expect(newSession.getHistory()).toHaveLength(1);
      expect(newSession.getHistory()[0].content).toBe('persisted message');
    });

    it('should clear session file on clear', async () => {
      await session.initialize();
      
      session.setCurrentBot('nutribot');
      await session.persist();
      
      await session.clear();
      
      // Verify file is deleted
      const sessionFile = path.join(testSessionDir, 'test-session.json');
      await expect(fs.access(sessionFile)).rejects.toThrow();
    });
  });
});
