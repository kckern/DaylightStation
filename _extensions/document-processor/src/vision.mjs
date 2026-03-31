import OpenAI from 'openai';

let client = null;

function getClient() {
  if (!client) {
    client = new OpenAI();
  }
  return client;
}

export function buildPrompt(pageCount, categories) {
  return `You are a document sorting assistant. You are looking at a contact sheet grid of ${pageCount} scanned pages. Each page has a number label in the bottom-right corner.

Your job:
1. Group pages into separate documents (a multi-page letter is one document, a single receipt is one document, etc.)
2. Identify the category of each document
3. Extract or estimate the document date from visible content
4. Flag any pages that are upside down or sideways

Allowed categories: ${categories.join(', ')}

Respond with ONLY valid JSON in this exact format:
{
  "documents": [
    {
      "pages": [1, 2, 3],
      "category": "Category",
      "description": "Brief human-readable description",
      "date": "YYYY-MM-DD",
      "issues": { "2": "upside_down" }
    }
  ]
}

Issue types: "upside_down", "sideways_right", "sideways_left"
If no date is visible, use null for the date field.
Every page number from 1 to ${pageCount} must appear in exactly one document group.`;
}

export function parseResponse(text) {
  let jsonStr = text.trim();

  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Failed to parse LLM response as JSON: ${e.message}`);
  }

  if (!parsed.documents || !Array.isArray(parsed.documents)) {
    throw new Error('Missing "documents" array in LLM response');
  }

  return parsed.documents;
}

export async function analyzeContactSheet(contactSheetPng, pageCount, categories, opts = {}) {
  const model = opts.model || process.env.VISION_MODEL || 'gpt-4o';
  const prompt = buildPrompt(pageCount, categories);

  const response = await getClient().chat.completions.create({
    model,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${contactSheetPng.toString('base64')}`,
            },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });

  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error('Empty response from vision LLM');

  return parseResponse(text);
}

export async function analyzeDetailPages(pageBuffers, pageNumbers, categories, opts = {}) {
  const model = opts.model || process.env.VISION_MODEL || 'gpt-4o';

  const imageContent = pageBuffers.map((buf, i) => ([
    {
      type: 'image_url',
      image_url: {
        url: `data:image/jpeg;base64,${buf.toString('base64')}`,
      },
    },
    { type: 'text', text: `This is page ${pageNumbers[i]}.` },
  ])).flat();

  const prompt = `These are higher-resolution versions of pages that were ambiguous in the initial scan. Identify: document grouping, category, date, orientation issues, and a brief description.

Allowed categories: ${categories.join(', ')}

Respond with ONLY valid JSON:
{
  "documents": [
    { "pages": [N], "category": "Category", "description": "Description", "date": "YYYY-MM-DD", "issues": {} }
  ]
}`;

  const response = await getClient().chat.completions.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: [...imageContent, { type: 'text', text: prompt }] }],
  });

  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error('Empty response from detail vision LLM');

  return parseResponse(text);
}
