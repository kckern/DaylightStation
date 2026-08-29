import { NutribotScaleRefusal } from '#apps/nutribot/ports/NutribotScaleRefusal.mjs';

/** Maps typed application refusals to the established bot/web result envelope. */
export class LegacyNutribotInputRouter {
  #inputRouter;

  constructor({ inputRouter }) {
    if (!inputRouter?.route) throw new Error('LegacyNutribotInputRouter requires inputRouter');
    this.#inputRouter = inputRouter;
  }

  async route(event, responseContext = null) {
    const result = await this.#inputRouter.route(event, responseContext);
    if (!(result instanceof NutribotScaleRefusal)) return result;
    return { success: false, error: result.message, code: result.code };
  }
}
