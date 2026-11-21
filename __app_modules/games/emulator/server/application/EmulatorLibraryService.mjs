/** Resolves catalog membership and per-user game rules for the emulator library. */
export class EmulatorLibraryService {
  constructor({ loadConfig, buildCatalog, resolveGameRules, logger = console }) {
    this.loadConfig = loadConfig;
    this.buildCatalog = buildCatalog;
    this.resolveGameRules = resolveGameRules;
    this.logger = logger;
  }

  getLibrary(user = null) {
    const config = this.loadConfig();
    const { systems, consoles } = this.buildCatalog(config, this.logger);
    const games = (config.games ?? []).filter((game) => game.system in systems).map((game) => {
      const rules = this.resolveGameRules(config, game.id, user) ?? {};
      return {
        id: game.id, system: game.system, title: game.title,
        saveMode: rules.saveMode ?? 'none', saveOwner: rules.saveOwner ?? null, core: rules.core ?? null,
        governance: rules.governance ?? null, shader: rules.shader ?? null,
        chrome: rules.chrome ?? null, native: rules.native ?? null,
        presentation: rules.presentation ?? null,
      };
    });
    return { systems, consoles, games, input: config.input ?? null, settings: config.settings ?? null };
  }

  /**
   * input.yml controllers that carry a `report_decoder` (input a remote sends
   * that the kernel drops), for the garage box to decode: [{ id, address,
   * report_decoder }]. Address upper-cased; entries without one are skipped.
   */
  getRemoteReportDecoders() {
    const controllers = this.loadConfig()?.input?.controllers;
    if (!Array.isArray(controllers)) return [];
    return controllers
      .filter((c) => c && typeof c.address === 'string' && c.address.trim() && c.report_decoder && typeof c.report_decoder === 'object')
      .map((c) => ({ id: c.id ?? null, address: c.address.trim().toUpperCase(), report_decoder: c.report_decoder }));
  }
}

export default EmulatorLibraryService;
