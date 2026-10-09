// backend/src/3_applications/agents/health-coach/schemas/dashboard.mjs

const contentItem = {
  type: 'object',
  required: ['content_id', 'title', 'duration'],
  properties: {
    content_id: { type: 'string', description: 'Plex content ID (e.g., "plex:12345")' },
    title: { type: 'string' },
    duration: { type: 'number', description: 'Duration in minutes' },
    program_context: { type: 'string', description: 'Program position context (e.g., "P90X Week 4, Day 2")' },
    reason: { type: 'string', description: 'Why this alternate was chosen (e.g., "rest_day_option")' },
  },
  additionalProperties: false,
};

export const dashboardSchema = {
  type: 'object',
  required: ['generated_at', 'curated', 'coach'],
  properties: {
    generated_at: { type: 'string', description: 'ISO 8601 timestamp' },

    curated: {
      type: 'object',
      required: ['up_next'],
      properties: {
        up_next: {
          type: 'object',
          required: ['primary'],
          properties: {
            primary: contentItem,
            alternates: {
              type: 'array',
              items: contentItem,
              maxItems: 3,
            },
          },
          additionalProperties: false,
        },
        playlist_suggestion: {
          type: 'array',
          items: contentItem,
          maxItems: 5,
        },
      },
      additionalProperties: false,
    },

    coach: {
      type: 'object',
      required: ['briefing'],
      properties: {
        briefing: { type: 'string', description: '2-3 sentence coaching commentary' },
        cta: {
          type: 'array',
          items: {
            type: 'object',
            required: ['type', 'message'],
            properties: {
              type: { type: 'string', enum: ['data_gap', 'observation', 'nudge'] },
              message: { type: 'string' },
              action: { type: 'string', description: 'Frontend action key (e.g., "open_nutrition")' },
            },
            additionalProperties: false,
          },
          maxItems: 3,
        },
        prompts: {
          type: 'array',
          items: {
            type: 'object',
            required: ['type', 'question'],
            properties: {
              type: { type: 'string', enum: ['voice_memo', 'multiple_choice', 'free_text'] },
              question: { type: 'string' },
              options: { type: 'array', items: { type: 'string' }, maxItems: 4 },
            },
            additionalProperties: false,
          },
          maxItems: 2,
        },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};
