export class SpeechSynthesis {
  constructor({ speechGateway }) { this.speechGateway = speechGateway; }
  status() { return this.speechGateway.getStatus(); }
  voices() { return this.speechGateway.getAvailableVoices(); }
  models() { return this.speechGateway.getAvailableModels(); }
  generate(text, options) { return this.speechGateway.generateSpeech(text, options); }
}
