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
  const systemPrompt = `Generate 4-5 short answer options for a journaling question.

CRITICAL: Keep each option to 5-12 words MAX. No full sentences.

Guidelines:
- Be concise and casual
- Cover a range of likely responses  
- Include specific and vague options
- One "other/none" type escape option

Good examples (SHORT):
["Had a nice walk", "Coffee with a friend", "Finally finished a project", "Nothing special", "Quality family time"]

Bad examples (TOO LONG - don't do this):
["I enjoyed a beautiful walk during my lunch break where I could soak up the sun"] ← way too long!

Respond with ONLY a JSON array of 4-5 short strings.`;

  let userContent = `Question: ${question}`;
  if (comment) {
    userContent = `Context: ${comment}\n\n${userContent}`;
  }
  if (history) {
    userContent = `Conversation:\n${history}\n\n${userContent}`;
  }

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent + '\n\nGenerate SHORT answer options:' },
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
    [PromptType.CONVERSATIONAL]: buildConversationalPrompt,
  };
  return builders[promptType] || null;
}

/**
 * Build conversational journaling prompt
 * Generates a natural follow-up response in one call
 * @param {string} history - Conversation history
 * @param {string} entry - User's latest entry
 * @returns {Array<{role: string, content: string}>}
 */
export function buildConversationalPrompt(history, entry) {
  const systemPrompt = `You are a curious friend helping someone reflect on their life through casual conversation. You have access to your recent conversation history.

IMPORTANT: If the user asks about something from the conversation history (like "what did I have for lunch?"), ANSWER from the history! Don't deflect or ask them to recall - you should recall it for them.

When the user shares something NEW, respond naturally with a follow-up that invites them to share more.

Guidelines:
- If user asks a recall question → Answer from history if available, or say "I don't see that in our recent chat"
- If user shares something new → Ask a natural follow-up question
- Be conversational and warm, but not over-the-top enthusiastic
- Keep it brief - 1-2 sentences max
- NO exclamation marks or cheerleading phrases

Examples of RECALL questions (answer from history):
- "What did I have for lunch?" → Look in history and answer: "You mentioned having sushi!"
- "When did I go to the gym?" → Look in history and answer: "You said you went yesterday afternoon"

Examples of NEW sharing (ask follow-up):
- "Had lunch" → "Nice, what was on the menu?"
- "Going camping this weekend" → "Sounds fun! Who's going with you?"

Respond in this exact JSON format:
{
  "acknowledgment": "",
  "question": "Your response here"
}

Put your ENTIRE response in the "question" field.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `${history ? `Recent conversation:\n${history}\n\n` : ''}User just wrote:\n"${entry}"\n\nRespond naturally:` },
  ];
}

/**
 * Build multiple choice options for conversational follow-up
 * @param {string} question - The follow-up question
 * @param {string} context - User's recent entry for context
 * @returns {Array<{role: string, content: string}>}
 */
export function buildConversationalChoicesPrompt(question, context) {
  const systemPrompt = `Generate 4 short, PLAUSIBLE answers to a journaling follow-up question.

CRITICAL RULES:
- Each option MUST directly answer the specific question asked
- Options should be things the user might actually say
- Be specific to the topic (food, places, times, activities, etc.)
- Keep options 2-6 words each
- Include variety: specific answers, vague answers, "neither/other" type options

EXAMPLES:

Question: "What did you have for lunch?"
Good: ["A sandwich", "Leftover pasta", "Just grabbed a coffee", "Skipped it actually"]
Bad: ["Feeling reflective", "No interest today", "Torn between choices"] ← too abstract

Question: "Where did you go?"
Good: ["Downtown", "The usual coffee shop", "Just stayed home", "Nowhere special"]
Bad: ["Contemplating options", "Mixed feelings"] ← doesn't answer WHERE

Question: "How was the meeting?"
Good: ["Pretty productive", "Dragged on forever", "Got cancelled", "Mixed bag"]

Respond with ONLY a JSON array of 4 strings.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `User said: "${context}"\n\nFollow-up question: "${question}"\n\nGenerate 4 plausible answers:` },
  ];
}

export default {
  buildBiographerPrompt,
  buildAutobiographerPrompt,
  buildTherapistPrompt,
  buildMultipleChoicePrompt,
  buildEvaluateResponsePrompt,
  buildConversationalPrompt,
  buildConversationalChoicesPrompt,
  getPromptBuilder,
};
