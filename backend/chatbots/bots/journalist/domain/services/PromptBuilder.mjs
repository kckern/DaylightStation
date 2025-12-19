/**
 * PromptBuilder Domain Service
 * @module journalist/domain/services/PromptBuilder
 * 
 * Builds prompts for AI interactions.
 */

import { PromptType } from '../value-objects/PromptType.mjs';

/**
 * Build biographer prompt (follow-up to user entry)
 * @param {string} history - Conversation history
 * @param {string} entry - User's latest entry
 * @returns {Array<{role: string, content: string}>}
 */
export function buildBiographerPrompt(history, entry) {
  const systemPrompt = `You are a compassionate biographer helping someone document their life story through daily journaling. Your role is to ask thoughtful follow-up questions that:

1. Show genuine interest and empathy
2. Encourage deeper reflection
3. Connect current experiences to broader life themes
4. Help uncover meaning and growth

Guidelines:
- Ask 1-3 follow-up questions based on what they shared
- Keep questions open-ended but focused
- Be warm but not intrusive
- Avoid yes/no questions
- Don't give advice unless specifically asked

Respond with just the question(s), no preamble.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Conversation history:\n${history}\n\nLatest entry:\n${entry}\n\nGenerate follow-up question(s):` },
  ];
}

/**
 * Build autobiographer prompt (initiate journaling)
 * @param {string} history - Recent conversation history
 * @returns {Array<{role: string, content: string}>}
 */
export function buildAutobiographerPrompt(history) {
  const systemPrompt = `You are a thoughtful journaling companion helping someone reflect on their day and life. Generate an opening question to start a journaling session.

Guidelines:
- Be warm and inviting
- Connect to the time of day when appropriate
- Vary topics: feelings, events, gratitude, goals, relationships
- Keep it simple and easy to answer
- One question only

If there's recent history, you may reference it lightly but don't force continuity.

Respond with just the question, no preamble.`;

  const userContent = history 
    ? `Recent conversation:\n${history}\n\nGenerate an opening question:`
    : 'Generate an opening question for a new journaling session:';

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];
}

/**
 * Build therapist analysis prompt
 * @param {string} history - Conversation history to analyze
 * @returns {Array<{role: string, content: string}>}
 */
export function buildTherapistPrompt(history) {
  const systemPrompt = `You are a supportive therapist providing insight based on journal entries. Your analysis should:

1. Identify emotional themes and patterns
2. Note positive developments and strengths
3. Gently highlight areas for potential growth
4. Offer supportive observations (not advice)

Be compassionate and constructive. Write 2-3 paragraphs.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Analyze these journal entries:\n\n${history}` },
  ];
}

/**
 * Build multiple choice prompt
 * @param {string} history - Conversation history
 * @param {string} comment - Optional context/comment
 * @param {string} question - The question to generate choices for
 * @returns {Array<{role: string, content: string}>}
 */
export function buildMultipleChoicePrompt(history, comment, question) {
  const systemPrompt = `Generate 4-6 possible answers for the given journaling question. The answers should:

1. Cover a range of likely responses
2. Include both positive and challenging options
3. Be specific and relatable
4. Allow for nuance (not just extremes)

Respond with ONLY a JSON array of strings, like:
["Option 1", "Option 2", "Option 3", "Option 4"]`;

  let userContent = `Question: ${question}`;
  if (comment) {
    userContent = `Context: ${comment}\n\n${userContent}`;
  }
  if (history) {
    userContent = `Conversation:\n${history}\n\n${userContent}`;
  }

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent + '\n\nGenerate answer options:' },
  ];
}

/**
 * Build evaluate response prompt
 * @param {string} history - Conversation history
 * @param {string} response - User's response
 * @param {string[]} plannedQuestions - Questions in queue
 * @returns {Array<{role: string, content: string}>}
 */
export function buildEvaluateResponsePrompt(history, response, plannedQuestions) {
  const systemPrompt = `Determine if the user's response allows continuing with planned follow-up questions, or if the topic has changed and we should generate new questions.

Respond with just "1" if we should continue with planned questions.
Respond with just "0" if the user changed topic or the planned questions no longer fit.`;

  const questionList = plannedQuestions.length > 0
    ? `\nPlanned questions:\n${plannedQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
    : '\nNo planned questions.';

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `History:\n${history}\n\nUser response: ${response}${questionList}\n\nShould we continue? (1 or 0):` },
  ];
}

/**
 * Get prompt builder by type
 * @param {string} promptType
 * @returns {Function}
 */
export function getPromptBuilder(promptType) {
  const builders = {
    [PromptType.BIOGRAPHER]: buildBiographerPrompt,
    [PromptType.AUTOBIOGRAPHER]: buildAutobiographerPrompt,
    [PromptType.THERAPIST_ANALYSIS]: buildTherapistPrompt,
    [PromptType.MULTIPLE_CHOICE]: buildMultipleChoicePrompt,
    [PromptType.EVALUATE_RESPONSE]: buildEvaluateResponsePrompt,
  };
  return builders[promptType] || null;
}

export default {
  buildBiographerPrompt,
  buildAutobiographerPrompt,
  buildTherapistPrompt,
  buildMultipleChoicePrompt,
  buildEvaluateResponsePrompt,
  getPromptBuilder,
};
