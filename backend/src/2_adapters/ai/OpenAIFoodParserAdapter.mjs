// backend/src/2_adapters/ai/OpenAIFoodParserAdapter.mjs
import { FoodItem } from '../../1_domains/lifelog/entities/FoodItem.mjs';

/**
 * OpenAI-based food parser implementing IFoodParser
 *
 * Uses GPT-4o-mini for parsing natural language food descriptions
 * into structured FoodItem entities with nutrition estimates.
 */
export class OpenAIFoodParserAdapter {
  #apiKey;
  #model;
  #baseUrl;
  #httpClient;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.apiKey - OpenAI API key
   * @param {string} [config.model='gpt-4o-mini'] - Model to use
   * @param {Object} deps
   * @param {import('#system/services/HttpClient.mjs').HttpClient} deps.httpClient
   * @param {Object} [deps.logger=console]
   */
  constructor(config, deps = {}) {
    if (!config.apiKey) {
      throw new Error('OpenAIFoodParserAdapter requires apiKey');
    }
    if (!deps.httpClient) {
      throw new Error('OpenAIFoodParserAdapter requires httpClient');
    }
    this.#apiKey = config.apiKey;
    this.#model = config.model || 'gpt-4o-mini';
    this.#baseUrl = 'https://api.openai.com/v1';
    this.#httpClient = deps.httpClient;
    this.#logger = deps.logger || console;
  }

  async #callOpenAI(messages, options = {}) {
    try {
      const response = await this.#httpClient.post(
        `${this.#baseUrl}/chat/completions`,
        {
          model: this.#model,
          messages,
          temperature: options.temperature ?? 0.3,
          max_tokens: options.maxTokens ?? 2000,
          response_format: { type: 'json_object' }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.#apiKey}`
          }
        }
      );

      if (response.data.error) {
        this.#logger.error?.('openai.error', { error: response.data.error });
        const err = new Error('AI API request failed');
        err.code = 'AI_API_ERROR';
        err.isTransient = false;
        throw err;
      }

      return response.data.choices[0].message.content;
    } catch (error) {
      if (error.code === 'AI_API_ERROR') throw error;

      this.#logger.error?.('openai.request.failed', {
        error: error.message,
        code: error.code
      });
      const wrapped = new Error('Failed to call AI API');
      wrapped.code = error.code || 'UNKNOWN_ERROR';
      wrapped.isTransient = error.isTransient || false;
      throw wrapped;
    }
  }

  #buildFoodParsePrompt(text, context = {}) {
    return [
      {
        role: 'system',
        content: `You are a nutrition AI that parses food descriptions into structured data.

Given a food description, extract:
- Individual food items with estimated portions
- Noom color category (green: <1 cal/g, yellow: 1-2.4 cal/g, orange: >2.4 cal/g)
- Estimated nutrition (calories, protein, carbs, fat, fiber, sodium)

Respond with JSON:
{
  "items": [
    {
      "label": "food name",
      "icon": "emoji",
      "grams": number,
      "unit": "g",
      "amount": number,
      "color": "green|yellow|orange",
      "calories": number,
      "protein": number,
      "carbs": number,
      "fat": number,
      "fiber": number,
      "sodium": number
    }
  ],
  "questions": ["clarification questions if portions unclear"]
}`
      },
      {
        role: 'user',
        content: `Parse this food: "${text}"${context.timezone ? ` (timezone: ${context.timezone})` : ''}`
      }
    ];
  }

  async parseText(text, context = {}) {
    const messages = this.#buildFoodParsePrompt(text, context);
    const response = await this.#callOpenAI(messages);

    try {
      const parsed = JSON.parse(response);

      this.#logger.debug?.('foodparser.parsed', {
        input: text,
        itemCount: parsed.items?.length || 0
      });

      return {
        items: (parsed.items || []).map(item => FoodItem.create(item)),
        questions: parsed.questions || []
      };
    } catch (err) {
      this.#logger.error?.('foodparser.parse.error', { error: err.message, response });
      throw new Error('Failed to parse food response');
    }
  }

  async parseImage(imageUrl, context = {}) {
    const messages = [
      {
        role: 'system',
        content: `You are a nutrition AI that identifies food in images.
Analyze the image and identify all visible food items with estimated portions.
Respond with the same JSON format as text parsing.`
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Identify the food in this image:' },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      }
    ];

    const response = await this.#callOpenAI(messages);
    const parsed = JSON.parse(response);

    return {
      items: (parsed.items || []).map(item => FoodItem.create(item)),
      questions: parsed.questions || []
    };
  }

  async parseVoice(audioBuffer, context = {}) {
    throw new Error('Voice parsing not yet implemented - requires transcription service');
  }
}
