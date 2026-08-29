/** Agenda construction and PNG rendering without exposing renderers or roster ports to HTTP. */
export class SchoolLifecycleAgendaResource {
  constructor({ buildAgenda = null, previewAgenda = null, pngRenderer = null, roster = null } = {}) {
    Object.assign(this, { buildAgenda, previewAgenda, pngRenderer, roster });
  }

  previewAvailability() { return availability(this.previewAgenda, this.pngRenderer); }
  issueAvailability() { return availability(this.buildAgenda, this.pngRenderer); }
  canRender() { return Boolean(this.pngRenderer); }
  learnerName(learnerId, explicitName = null) {
    if (explicitName) return explicitName;
    return this.roster?.displayName?.(learnerId) ?? null;
  }
  preview(command) { return this.previewAgenda.execute(command); }
  issue(command) { return this.buildAgenda.execute(command); }
  async render(document) {
    const { canvas } = await this.pngRenderer.createCanvas(document, { tokens: {} });
    return canvas.toBuffer('image/png');
  }
}

function availability(operation, renderer) {
  if (operation && renderer) return 'ready';
  if (operation || renderer) return 'partial';
  return 'absent';
}

export default SchoolLifecycleAgendaResource;
