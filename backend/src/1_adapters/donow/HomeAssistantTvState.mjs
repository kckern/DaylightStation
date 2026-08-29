/** Adapts the Home Assistant TV state response to DoNow's boolean TV port. */
export class HomeAssistantTvState {
  constructor({ tvAdapter, entityId = 'living_room' } = {}) {
    if (!tvAdapter?.getState) throw new Error('HomeAssistantTvState requires tvAdapter');
    this.tvAdapter = tvAdapter;
    this.entityId = entityId;
  }

  async isOn() {
    const state = await this.tvAdapter.getState(this.entityId);
    return state?.state === 'on';
  }
}
