import { ISchoolLearningActionExecutor } from '#apps/school/ports/ISchoolLearningActionExecutor.mjs';

/**
 * Anti-corruption adapter from School learning intents to the existing print
 * and trigger application services. It is late-bound because those services
 * are composed after SchoolCalc during station boot.
 */
export class SchoolLearningActionExecutor extends ISchoolLearningActionExecutor {
  #printService = null; #triggerService = null;

  bind({ printService = null, triggerDispatchService = null } = {}) {
    if (printService !== null && typeof printService.requestPrint !== 'function') {
      throw new Error('School learning action print service must expose requestPrint');
    }
    if (triggerDispatchService !== null && typeof triggerDispatchService.handleTrigger !== 'function') {
      throw new Error('School learning action trigger service must expose handleTrigger');
    }
    this.#printService = printService;
    this.#triggerService = triggerDispatchService;
    return this;
  }

  async execute({ action, learnerId, scannerDevice } = {}) {
    if (action?.kind === 'print_document') return this.#print(action, learnerId);
    if (action?.kind === 'launch_media') return this.#launch(action, scannerDevice);
    throw new Error(`Unsupported School learning action kind '${action?.kind ?? 'missing'}'`);
  }

  async #print(action, learnerId) {
    if (!this.#printService) return unavailable('Printing is not configured. Tell a grown-up.');
    if (!learnerId) return unavailable('This calculator needs a learner before it can print.');
    const result = await this.#printService.requestPrint({
      userId: learnerId,
      printableId: action.target.printableId,
      copies: action.target.copies ?? 1,
    });
    if (result.decision === 'printed') return {
      status: 'printed', message: 'Your worksheet is printing.', physical: 'worksheet', printed: true,
      effect: { printableId: action.target.printableId, pages: result.pages },
    };
    if (result.decision === 'approval') return {
      status: 'pending_approval', message: 'A grown-up needs to approve that print.', physical: 'none', printed: false,
      effect: { requestId: result.requestId, pages: result.pages },
    };
    return {
      status: 'denied', message: result.reason || 'That worksheet cannot print right now.',
      physical: 'none', printed: false, effect: { pages: result.pages },
    };
  }

  async #launch(action, scannerDevice) {
    if (!this.#triggerService || !scannerDevice) {
      return unavailable('No media screen is available from this scanner.');
    }
    const result = await this.#triggerService.handleTrigger(
      scannerDevice,
      'barcode',
      action.target.contentCode,
    );
    if (!result?.ok) return {
      status: 'unavailable', message: 'That media could not start. Tell a grown-up.',
      physical: 'none', printed: false, effect: { code: result?.code ?? null },
    };
    return {
      status: result.debounced ? 'already_running' : 'launched',
      message: result.debounced ? 'That media is already starting.' : 'Starting that lesson media.',
      physical: 'none', printed: false,
      effect: { dispatchId: result.dispatchId ?? null, target: result.target ?? null },
    };
  }
}

function unavailable(message) {
  return { status: 'unavailable', message, physical: 'none', printed: false, effect: null };
}

export default SchoolLearningActionExecutor;
