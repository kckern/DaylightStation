import { IKeyboardBindingCatalog } from '#apps/devices/ports/IKeyboardBindingCatalog.mjs';

export class ConfigKeyboardBindingCatalog extends IKeyboardBindingCatalog {
  #loadFile;
  constructor({ loadFile }) { super(); this.#loadFile = loadFile; }
  list() { return this.#loadFile('triggers/bindings/keyboard') || []; }
}
