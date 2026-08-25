/** Application port for durable spaced-repetition scheduling. */
export class IFlashcardScheduler {
  initial() { throw new Error('IFlashcardScheduler.initial must be implemented'); }
  rate() { throw new Error('IFlashcardScheduler.rate must be implemented'); }
  preview() { throw new Error('IFlashcardScheduler.preview must be implemented'); }
  retrievability() { throw new Error('IFlashcardScheduler.retrievability must be implemented'); }
  forget() { throw new Error('IFlashcardScheduler.forget must be implemented'); }
  rollback() { throw new Error('IFlashcardScheduler.rollback must be implemented'); }
}
export default IFlashcardScheduler;
