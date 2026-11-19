/**
 * Process Text Entry Use Case (dearDiary)
 * @module journalist/application/usecases/ProcessTextEntry
 *
 * Main use case for processing text journal entries.
 * Implements conversational journaling loop with active listening.
 */

import { ConversationMessage } from "../../domain/entities/ConversationMessage.mjs";
import { nowTs24, formatLocalTimestamp } from '#system/utils/time.mjs';
import {
  formatAsChat,
  truncateToLength,
} from "../../domain/services/HistoryFormatter.mjs";
import { parseGPTResponse } from "../services/QuestionParser.mjs";
import { formatChoicesAsKeyboard } from "../../domain/services/QueueManager.mjs";
import {
  buildConversationalPrompt,
  buildConversationalChoicesPrompt,
} from "../../domain/services/PromptBuilder.mjs";

/**
 * @typedef {Object} ProcessTextEntryInput
 * @property {string} chatId
 * @property {string} text
 * @property {string} messageId
 * @property {string} senderId
 * @property {string} senderName
 * @property {boolean} [userMessageSaved] - The entry is already in the journal
 *   (saveUserMessage was called); execute only answers it
 * @property {Date} [timestamp] - When the entry was made, if that was not now
 *   (a memo recorded earlier and uploaded later). Left out, the entry is
 *   stamped with the time it is processed, as it always has been.
 */

/**
 * Process text entry use case
 */
export class ProcessTextEntry {
  #messagingGateway;
  #aiGateway;
  #journalEntryRepository;
  #messageQueueRepository;
  #conversationStateStore;
  #logger;
  #knowledgeCompanion;
  #workCompanion;
  #clock;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.aiGateway) throw new Error('aiGateway is required');

    this.#knowledgeCompanion=deps.knowledgeCompanion;
    this.#workCompanion=deps.workCompanion;
    this.#clock=deps.clock??Date.now;
    this.#messagingGateway = deps.messagingGateway;
    this.#aiGateway = deps.aiGateway;
    this.#journalEntryRepository = deps.journalEntryRepository;
    this.#messageQueueRepository = deps.messageQueueRepository;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#logger = deps.logger || console;
  }

  /**
   * Get messaging interface (prefers responseContext for DDD compliance)
   * @private
   */
  #getMessaging(responseContext, chatId) {
    if (responseContext) {
      return responseContext;
    }
    return {
      sendMessage: (text, options) => this.#messagingGateway.sendMessage(chatId, text, options),
      updateMessage: (msgId, updates) => this.#messagingGateway.updateMessage(chatId, msgId, updates),
      deleteMessage: (msgId) => this.#messagingGateway.deleteMessage(chatId, msgId),
    };
  }

  /**
   * Save the user's entry to the journal: the first step of execute(), on its
   * own for a caller that must have the entry stored before anything is sent
   * (SubmitVoiceMemo, which then calls execute with `userMessageSaved`).
   * @param {ProcessTextEntryInput} input
   */
  async saveUserMessage({ chatId, text, messageId, senderId, senderName, timestamp }) {
    const userMessage = ConversationMessage.createUserMessage({
      messageId,
      chatId,
      timestamp: timestamp ? formatLocalTimestamp(timestamp) : nowTs24(),
      senderId,
      senderName,
      text,
    });

    if (this.#journalEntryRepository) {
      // The repository stamps the stored entry itself. It is told a time
      // only when the entry was not made now.
      if (timestamp) await this.#journalEntryRepository.saveMessage?.(userMessage, { at: timestamp });
      else await this.#journalEntryRepository.saveMessage?.(userMessage);
    }
  }

  /**
   * Execute the use case
   * @param {ProcessTextEntryInput} input
   */
  async execute(input) {
    const { chatId, text, messageId, senderId, senderName, responseContext, timestamp, userMessageSaved = false } = input;

    this.#logger.debug?.('textEntry.process.start', { chatId, textLength: text.length, hasResponseContext: !!responseContext });

    const messaging = this.#getMessaging(responseContext, chatId);

    // Create status indicator for AI processing
    let status = null;
    if (messaging.createStatusIndicator) {
      status = await messaging.createStatusIndicator(
        '💭 Thinking',
        { frames: ['.', '..', '...'], interval: 2000 }
      );
    }

    try {
      // 1. Save message to history
      const userMessage = ConversationMessage.createUserMessage({
        messageId,
        chatId,
        timestamp: timestamp ? formatLocalTimestamp(timestamp) : nowTs24(),
        senderId,
        senderName,
        text,
      });

      let savedMessage;
      const knowledgeSource=this.#knowledgeCompanion?.sourceForEntry({principal:input.knowledgePrincipal,chatId,messageId,senderId});
      let workSource=null;try{workSource=this.#workCompanion?.sourceForEntry({principal:input.workPrincipal,chatId,messageId,senderId})??null;}catch{this.#logger.warn?.('journalist.work.source-unavailable');}
      const sameSource=!knowledgeSource||!workSource||['platform','conversationId','messageId','senderId','revision','edited','editDate','updateId'].every(key=>(knowledgeSource[key]??null)===(workSource[key]??null));
      const source=sameSource?(knowledgeSource??workSource):null;
      if(!sameSource)this.#logger.warn?.('journalist.provenance.mismatch');
      const receipt=source||input.journalEdit?{messageId:userMessage.messageId,chatId:userMessage.chatId,text:userMessage.text,timestamp:userMessage.timestamp,senderId:userMessage.senderId,senderName:userMessage.senderName,role:'user',...(source?{source}:{}),...(input.journalEdit?{edit:input.journalEdit}:{})}:userMessage;
      if (!userMessageSaved && this.#journalEntryRepository) {
        savedMessage = timestamp
          ? await this.#journalEntryRepository.saveMessage?.(receipt, { at: timestamp })
          : await this.#journalEntryRepository.saveMessage?.(receipt);
      }
      if(savedMessage?.ignoredEdit){await status?.cancel?.();return {success:true,ignoredEdit:true};}
      const suppressByPolicy=this.#knowledgeCompanion?.shouldSuppressFollowUp?.({principal:input.knowledgePrincipal,length:(savedMessage?.content??savedMessage?.text??text).length})===true;
      let workResult=null;
      if(source&&workSource&&savedMessage){try{workResult=await this.#workCompanion.onEntrySaved({principal:input.workPrincipal,message:savedMessage,asOf:this.#clock()});}catch{this.#logger.warn?.('journalist.work.entry-unavailable');}}
      if(source&&knowledgeSource&&savedMessage){
        let knowledge;
        try{knowledge=await this.#knowledgeCompanion.onEntrySaved({principal:input.knowledgePrincipal,message:savedMessage,replyToMessageId:source.replyToMessageId,asOf:this.#clock()});}
        catch{this.#logger.warn?.('journalist.knowledge.entry-unavailable');}
        if(knowledge?.suppressFollowUp||suppressByPolicy){
          if(knowledge?.ackHandled===false||!knowledge?.suppressFollowUp){
            if(status)await status.finish('📝 Noted.');else await messaging.sendMessage('📝 Noted.',{});
          }else await status?.cancel?.();
          return {success:true,knowledgeScheduled:!!knowledge?.scheduled,suppressedFollowUp:true};
        }
      }
      if(workResult?.suppressFollowUp){
        if(workResult.ackHandled)await status?.cancel?.();else if(status)await status.finish('📝 Noted.');else await messaging.sendMessage('📝 Noted.',{});
        return {success:true,suppressedFollowUp:true,workHandled:true};
      }
      if(savedMessage&&suppressByPolicy){
        if(status)await status.finish('📝 Noted.');else await messaging.sendMessage('📝 Noted.',{});
        return {success:true,suppressedFollowUp:true};
      }
      if(input.aiAvailable===false){
        if(status)await status.finish('📝 Noted.');else await messaging.sendMessage('📝 Noted.',{});
        return {success:true};
      }

      // 2. Load conversation history
      const history = await this.#loadHistory(chatId);
      const historyText = formatAsChat(history);

      // 3. Generate conversational response (acknowledgment + follow-up)
      const response = await this.#generateConversationalResponse(historyText, text);

      if (!response) {
        // Fallback: just acknowledge
        let sentId;
        if (status) {
          sentId = await status.finish('📝 Noted.');
        } else {
          const result = await messaging.sendMessage('📝 Noted.', {});
          sentId = result.messageId;
        }

        // Save bot response
        if (this.#journalEntryRepository) {
          const botMessage = ConversationMessage.createBotMessage({
            messageId: sentId,
            chatId,
            timestamp: nowTs24(),
            text: '📝 Noted.',
          });
          await this.#journalEntryRepository.saveMessage?.(botMessage);
        }

        return { success: true, messageId: sentId };
      }

      // 4. Generate multiple choice options for the follow-up question
      // Get debrief summary from state if available
      const state = this.#conversationStateStore
        ? await this.#conversationStateStore.get(chatId)
        : null;
      const debriefSummary = state?.debrief?.summary || state?.summary || null;

      const choices = await this.#generateConversationalChoices(
        response.question,
        text,
        historyText,
        debriefSummary,
      );

      // 5. Build message - use question as the full response (acknowledgment may be empty)
      const message = response.acknowledgment
        ? `${response.acknowledgment}\n\n${response.question}`
        : response.question;

      // 6. Send with reply keyboard (attached to chat input)
      let sentId;
      if (status) {
        sentId = await status.finish(message, { choices });
      } else {
        const result = await messaging.sendMessage(message, { choices });
        sentId = result.messageId;
      }

      // 7. Save bot response to history
      if (this.#journalEntryRepository) {
        const botMessage = ConversationMessage.createBotMessage({
          messageId: sentId,
          chatId,
          timestamp: nowTs24(),
          text: message,
        });
        await this.#journalEntryRepository.saveMessage?.(botMessage);
      }

      this.#logger.info?.('textEntry.process.complete', { chatId });

      return {
        success: true,
        messageId: sentId,
        acknowledgment: response.acknowledgment,
        question: response.question,
      };
    } catch (error) {
      this.#logger.error?.('textEntry.process.error', { chatId, error: error.message });

      // Show error in status indicator if available
      if (status) {
        try {
          await status.finish('⚠️ Sorry, something went wrong. Please try again.');
        } catch (e) {
          // Ignore
        }
      }

      throw error;
    }
  }

  /**
   * Generate conversational response (acknowledgment + follow-up question)
   * @private
   */
  async #generateConversationalResponse(history, entry) {
    const prompt = buildConversationalPrompt(truncateToLength(history, 2000), entry);

    try {
      const response = await this.#aiGateway.chat(prompt, { maxTokens: 150 });

      // Parse JSON response - extract from markdown code blocks if needed
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        // The reply can quote the entry back, so only its size is logged.
        this.#logger.warn?.('textEntry.conversational.noJsonFound', { responseLength: String(response ?? '').length });
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Accept response if question exists (acknowledgment may be empty)
      if (parsed.question) {
        return {
          acknowledgment: parsed.acknowledgment || '',
          question: parsed.question,
        };
      }
    } catch (error) {
      this.#logger.warn?.('textEntry.conversational.parseFailed', {
        error: error.message,
      });
    }

    return null;
  }

  /**
   * Generate multiple choice options for conversational follow-up
   * @param {string} question - The follow-up question
   * @param {string} context - User's recent entry
   * @param {string} [history] - Conversation history
   * @param {string} [debriefSummary] - Daily debrief summary
   * @private
   */
  async #generateConversationalChoices(question, context, history = '', debriefSummary = null) {
    const prompt = buildConversationalChoicesPrompt(question, context, {
      history: truncateToLength(history, 1500),
      debriefSummary: debriefSummary ? truncateToLength(debriefSummary, 800) : null,
    });

    try {
      const response = await this.#aiGateway.chat(prompt, { maxTokens: 100 });

      // Try to parse as JSON array
      let choices = [];
      try {
        choices = JSON.parse(response);
      } catch {
        // Try to extract from markdown code block
        const match = response.match(/\[[\s\S]*\]/);
        if (match) {
          choices = JSON.parse(match[0]);
        }
      }

      if (Array.isArray(choices) && choices.length >= 2) {
        return formatChoicesAsKeyboard(choices.slice(0, 4));
      }
    } catch (error) {
      this.#logger.warn?.('textEntry.choices.parseFailed', { error: error.message });
    }

    // Fallback: generic options + close
    return formatChoicesAsKeyboard(['Yes', 'No', 'Tell me more']);
  }

  /**
   * Load conversation history
   * @private
   */
  async #loadHistory(chatId) {
    if (!this.#journalEntryRepository?.getMessageHistory) {
      return [];
    }
    // Load up to 100 messages (roughly covers 7 days of active conversation)
    return this.#journalEntryRepository.getMessageHistory(chatId, 100);
  }
}

export default ProcessTextEntry;
