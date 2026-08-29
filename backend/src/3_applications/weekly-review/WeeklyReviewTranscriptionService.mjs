/** Transcribes and cleans a weekly-review conversation without changing its content. */
export class WeeklyReviewTranscriptionService {
  constructor({ aiGateway }) {
    this.aiGateway = aiGateway;
  }

  async transcribe(buffer, options) {
    const transcriptRaw = await this.aiGateway.transcribe(buffer, {
      filename: 'weekly-review.webm',
      contentType: options.mimeType,
      prompt: options.prompt,
    });
    const transcriptClean = await this.aiGateway.chat([
      { role: 'system', content: 'Clean up this family conversation transcript. Fix spelling, grammar, and punctuation. Preserve the natural conversational tone. Do not add or remove content.' },
      { role: 'user', content: transcriptRaw },
    ], { temperature: 0.2, maxTokens: 4000 });
    return { transcriptRaw, transcriptClean };
  }
}

export default WeeklyReviewTranscriptionService;
