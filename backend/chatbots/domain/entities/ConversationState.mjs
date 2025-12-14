/**
 * ConversationState entity for managing conversation flow state
 * @module domain/entities/ConversationState
 */

import { ConversationId } from '../value-objects/ChatId.mjs';
import { MessageId } from '../value-objects/MessageId.mjs';
import { Timestamp } from '../value-objects/Timestamp.mjs';
import { ValidationError } from '../../_lib/errors/index.mjs';

/**
 * Default TTL for conversation state (30 minutes)
 */
const DEFAULT_TTL_MS = 30 * 60 * 1000;

/**
 * ConversationState entity
 * Manages ephemeral state for a conversation (e.g., current flow, cursor position)
 */
export class ConversationState {
  /**
   * @param {object} props - State properties
   * @param {ConversationId|object} props.conversationId - Conversation identifier
   * @param {string} [props.activeFlow] - Currently active flow name
   * @param {object} [props.flowState] - Flow-specific state
   * @param {MessageId|string|number} [props.lastMessageId] - Last message ID
   * @param {Timestamp|Date|string} [props.updatedAt] - Last update timestamp
   * @param {Timestamp|Date|string} [props.expiresAt] - Expiration timestamp
   */
  constructor(props) {
    // Support both conversationId and legacy chatId
    const convId = props.conversationId || props.chatId;
    if (!convId) {
      throw new ValidationError('conversationId is required');
    }

    this.conversationId = convId instanceof ConversationId ? convId : ConversationId.from(convId);
    // Alias for backward compatibility
    this.chatId = this.conversationId;
    this.activeFlow = props.activeFlow || null;
    this.flowState = Object.freeze({ ...props.flowState });
    this.lastMessageId = props.lastMessageId 
      ? (props.lastMessageId instanceof MessageId ? props.lastMessageId : MessageId.from(props.lastMessageId))
      : null;
    
    const now = Timestamp.now();
    this.updatedAt = props.updatedAt instanceof Timestamp 
      ? props.updatedAt 
      : Timestamp.from(props.updatedAt || now);
    
    this.expiresAt = props.expiresAt instanceof Timestamp
      ? props.expiresAt
      : props.expiresAt 
        ? Timestamp.from(props.expiresAt)
        : now.add(DEFAULT_TTL_MS, 'ms');

    // Freeze to ensure immutability
    Object.freeze(this);
  }

  /**
   * Check if the state has expired
   * @returns {boolean}
   */
  get isExpired() {
    return Timestamp.now().isAfter(this.expiresAt);
  }

  /**
   * Check if there's an active flow
   * @returns {boolean}
   */
  get hasActiveFlow() {
    return this.activeFlow !== null;
  }

  /**
   * Get a value from flow state
   * @param {string} key - State key
   * @param {any} [defaultValue] - Default if not found
   * @returns {any}
   */
  getFlowValue(key, defaultValue = undefined) {
    return this.flowState[key] ?? defaultValue;
  }

  /**
   * Convert to plain object
   * @returns {object}
   */
  toJSON() {
    return {
      conversationId: this.conversationId.toJSON(),
      // Include chatId for backward compatibility
      chatId: this.conversationId.toJSON(),
      activeFlow: this.activeFlow,
      flowState: this.flowState,
      lastMessageId: this.lastMessageId?.toJSON() || null,
      updatedAt: this.updatedAt.toJSON(),
      expiresAt: this.expiresAt.toJSON(),
    };
  }

  /**
   * Create a new ConversationState with updated properties
   * @param {object} updates - Properties to update
   * @returns {ConversationState}
   */
  with(updates) {
    return new ConversationState({
      conversationId: this.conversationId,
      activeFlow: this.activeFlow,
      flowState: this.flowState,
      lastMessageId: this.lastMessageId,
      updatedAt: Timestamp.now(),
      expiresAt: Timestamp.now().add(DEFAULT_TTL_MS, 'ms'),
      ...updates,
    });
  }

  /**
   * Start a new flow
   * @param {string} flowName - Name of the flow
   * @param {object} [initialState] - Initial flow state
   * @returns {ConversationState}
   */
  startFlow(flowName, initialState = {}) {
    return this.with({
      activeFlow: flowName,
      flowState: initialState,
    });
  }

  /**
   * Update flow state
   * @param {object} stateUpdates - State updates to merge
   * @returns {ConversationState}
   */
  updateFlowState(stateUpdates) {
    return this.with({
      flowState: { ...this.flowState, ...stateUpdates },
    });
  }

  /**
   * Clear the active flow
   * @returns {ConversationState}
   */
  clearFlow() {
    return this.with({
      activeFlow: null,
      flowState: {},
    });
  }

  /**
   * Clear a specific flow (only if it's active)
   * @param {string} flowName - Name of the flow to clear
   * @returns {ConversationState}
   */
  clearSpecificFlow(flowName) {
    if (this.activeFlow !== flowName) {
      return this;
    }
    return this.clearFlow();
  }

  /**
   * Set the last message ID
   * @param {MessageId|string|number} messageId
   * @returns {ConversationState}
   */
  setLastMessage(messageId) {
    return this.with({
      lastMessageId: messageId instanceof MessageId ? messageId : MessageId.from(messageId),
    });
  }

  /**
   * Create an empty state for a conversation
   * @param {ConversationId|object} conversationId - Conversation identifier
   * @returns {ConversationState}
   */
  static empty(conversationId) {
    return new ConversationState({
      conversationId,
      activeFlow: null,
      flowState: {},
      lastMessageId: null,
    });
  }

  /**
   * Create from a plain object
   * @param {object} obj
   * @returns {ConversationState}
   */
  static from(obj) {
    if (obj instanceof ConversationState) return obj;
    return new ConversationState(obj);
  }
}

export default ConversationState;
