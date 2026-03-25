/**
 * Output schema for coaching messages sent via messaging channel.
 * Used by nutrition coaching assignments (MorningBrief, NoteReview, etc.)
 */
export const coachingMessageSchema = {
  type: 'object',
  properties: {
    should_send: { type: 'boolean', description: 'Whether a message should be sent. False = stay silent.' },
    text: { type: 'string', description: 'Message text (HTML formatted)' },
    parse_mode: { type: 'string', enum: ['HTML', 'Markdown'], default: 'HTML' },
  },
  required: ['should_send'],
  if: { properties: { should_send: { const: true } } },
  then: { required: ['should_send', 'text'] },
};
