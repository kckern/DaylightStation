/**
 * QuestionParser Domain Service
 * @module journalist/domain/services/QuestionParser
 *
 * Parses AI responses to extract questions.
 */

/**
 * Split text on question marks
 * @param {string} text
 * @returns {string[]}
 */
function splitOnQuestionMarks(text) {
  // Split on ? followed by space or end
  const parts = text.split(/\?(?:\s|$)/);

  return parts
    .map((part) => part.trim())
    .filter((part) => {
      // Must have some content
      if (part.length < 5) return false;
      // Should look like a question
      return true;
    })
    .map((part) => part + '?'); // Add question mark back
}

/**
 * Parse GPT response for questions
 * @param {string} text - AI response text
 * @returns {string[]} - Extracted questions
 */
export function parseGPTResponse(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  // Try JSON parse first
  try {
    // Check for JSON array
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.filter((q) => typeof q === 'string' && q.trim().length > 0);
      }
    }
  } catch {
    // Not valid JSON, continue with text parsing
  }

  // Strip markdown code blocks
  let cleaned = text.replace(/```json?\s*([\s\S]*?)```/g, '$1').trim();

  // Try JSON again after stripping markdown
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed.filter((q) => typeof q === 'string' && q.trim().length > 0);
    }
  } catch {
    // Still not JSON
  }

  // Fall back to splitting on question marks
  const questions = splitOnQuestionMarks(cleaned);
  if (questions.length > 0) {
    return questions;
  }

  // Last resort: return the whole thing as one question
  const trimmed = cleaned.trim();
  if (trimmed.length > 0 && trimmed.length < 500) {
    return [trimmed];
  }

  return [];
}

/**
 * Split compound questions into separate questions
 * @param {string} text - Text that may contain multiple questions
 * @returns {string[]}
 */
export function splitMultipleQuestions(text) {
  if (!text) return [];

  // Check for numbered questions (1. Question? 2. Question?)
  const numberedMatch = text.match(/\d+\.\s*[^?]+\?/g);
  if (numberedMatch && numberedMatch.length > 1) {
    return numberedMatch.map((q) => q.replace(/^\d+\.\s*/, '').trim());
  }

  // Check for bullet points
  const bulletMatch = text.match(/[-•]\s*[^?]+\?/g);
  if (bulletMatch && bulletMatch.length > 1) {
    return bulletMatch.map((q) => q.replace(/^[-•]\s*/, '').trim());
  }

  // Split on question mark followed by capital letter or new line
  const parts = text.split(/\?\s*(?=[A-Z]|\n)/);
  if (parts.length > 1) {
    return parts
      .map((p) => p.trim())
      .filter((p) => p.length > 5)
      .map((p) => (p.endsWith('?') ? p : p + '?'));
  }

  // Return as single question
  return text.includes('?') ? [text.trim()] : [];
}

/**
 * Clean up question formatting
 * @param {string} question
 * @returns {string}
 */
export function cleanQuestion(question) {
  if (!question) return '';

  return question
    .replace(/^[\s\d.\-•]+/, '') // Remove leading numbers, dots, bullets
    .replace(/^["']+|["']+$/g, '') // Remove quotes
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Check if text looks like a valid question
 * @param {string} text
 * @returns {boolean}
 */
export function isValidQuestion(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();

  // Too short or too long
  if (trimmed.length < 10 || trimmed.length > 500) return false;

  // Should have a question mark or start with question word
  const hasQuestionMark = trimmed.includes('?');
  const startsWithQuestionWord =
    /^(what|how|why|when|where|who|which|can|could|would|do|did|is|are|was|were|have|has)/i.test(
      trimmed,
    );

  return hasQuestionMark || startsWithQuestionWord;
}

export default {
  parseGPTResponse,
  splitMultipleQuestions,
  cleanQuestion,
  isValidQuestion,
};
