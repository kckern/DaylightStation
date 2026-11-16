import {weekOf} from '../domain/calendar.mjs';

/** Agenda is a navigation source; it never supplies a media flattening operation. */
export class AgendaContentAdapter {
  source = 'agenda';
  acceptsListContext = true;
  prefixes = [];
  async getItem() { return null; }
  constructor({repository, projector, resolveHousehold, clock = () => new Date()}) {
    if (!repository || !projector?.project || typeof resolveHousehold !== 'function') throw new Error('Agenda source dependencies required');
    Object.assign(this,{repository,projector,resolveHousehold,clock});
  }
  getCapabilities() { return ['listable']; }
  async getList(address, {viewer,participantLaunchVersion = null} = {}) {
    const localId = address.startsWith('agenda:') ? address.slice(7) : address;
    const parts = localId.split('/');
    const [seriesId, route, planId] = parts;
    if (!seriesId || parts.length > 3 || (route && !['current','weeks','plans'].includes(route)) || (route === 'plans' ? !planId : !!planId)) throw Object.assign(new Error('Invalid Agenda address'),{code:'not_found'});
    const householdId = await this.resolveHousehold({viewer,seriesId});
    const series = (await this.repository.readSeries({householdId,seriesId}))?.document;
    if (!series) throw Object.assign(new Error('Agenda series unavailable'),{code:'not_found'});
    const currentWeek = weekOf({instant:this.clock(),timezone:series.calendar.timezone});
    const plans = (await this.repository.listPlans({householdId,seriesId})).map(result=>result.document);
    const nav = (id,title) => ({id,title,itemType:'container',actions:{list:{contentId:id}}});
    const weeks = nav(`agenda:${seriesId}/weeks`,'Browse published weeks');
    const common = {adminUrl:`/admin/content/agendas/${encodeURIComponent(seriesId)}`,resolveCapabilities:true,privateResponse:true,disableAutoCountdown:true,navigationPolicy:'return-to-selected',fixedOrder:true};
    if (route === 'weeks') return {...common,id:`agenda:${seriesId}/weeks`,title:`${series.title} — Published weeks`,items:plans.filter(p=>p.state==='published').sort((a,b)=>b.week_of.localeCompare(a.week_of)).map(p=>nav(`agenda:${seriesId}/plans/${p.plan_id}`,p.week_of))};
    const plan = route === 'plans' ? plans.find(p=>p.plan_id===planId) : plans.find(p=>p.week_of===currentWeek);
    const prefix = `${series.title} — ${plan?.week_of || currentWeek}`;
    if (!plan || plan.state !== 'published' || series.status !== 'active') {
      const reason = series.status !== 'active' ? 'This series is archived.' : !plan ? 'No plan exists for this week.' : plan.state === 'draft' ? 'This week is not published.' : 'This week is cancelled or archived.';
      return {...common,id:route === 'plans' ? `agenda:${seriesId}/plans/${planId}` : `agenda:${seriesId}/current`,title:prefix,notice:`${plan?.week_of || currentWeek}: ${reason}`,items:[weeks]};
    }
    const preview = plan.week_of !== currentWeek;
    const menu = await this.projector.project({plan,viewer,preview,participantLaunchVersion});
    return {...common,...menu,notice:menu.items.length ? (preview ? 'Preview only; activities cannot be started.' : undefined) : 'This published plan is empty.',items:[...menu.items,weeks]};
  }
}
