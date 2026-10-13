import {it,expect,vi} from 'vitest';
import {PlexAdapter} from './PlexAdapter.mjs';
import {pianoCurriculumEnrichment} from '../../../../../../__app_modules/piano/server/composition/plex-curriculum.mjs';
import * as owned from '../../../../../../__app_modules/piano/server/adapters/plex-curriculum/CurriculumIndex.mjs';
it('M3 Plex enrichment preserves all three synchronous merge sites and the owned cache authority',()=>{
  for(const key of ['getCurriculumIndex','mergeEpisode','mergeSeason'])expect(pianoCurriculumEnrichment[key]).toBe(owned[key]);
  const index={synthetic:true},piano={course:'synthetic'},episode={ratingKey:'e',type:'episode',grandparentRatingKey:'show',parentIndex:2,index:3,title:'Original',duration:1000,Media:[]},season={ratingKey:'s',type:'season',parentRatingKey:'show',index:2,title:'Original',Media:[]};
  const enrichment={getCurriculumIndex:vi.fn(()=>index),mergeEpisode:vi.fn(()=>({title:'Owned episode',piano})),mergeSeason:vi.fn(()=>({title:'Owned season',piano}))};
  const make=curriculumEnrichment=>new PlexAdapter({host:'http://synthetic.invalid',logger:{}},{httpClient:{get:vi.fn(),post:vi.fn()},curriculumEnrichment});
  const adapter=make(enrichment),list=adapter._toListableItem(episode),container=adapter._toPlayableItem(season),playable=adapter._toPlayableItem(episode);
  expect([list.title,container.title,playable.title]).toEqual(['Owned episode','Owned season','Owned episode']);
  for(const item of [list,container,playable])expect(item.metadata.piano).toBe(piano);
  expect(enrichment.getCurriculumIndex.mock.calls).toEqual([['show'],['show'],['show']]);
  expect(enrichment.mergeEpisode.mock.calls).toEqual([[index,{season:2,episode:3}],[index,{season:2,episode:3}]]);
  expect(enrichment.mergeSeason).toHaveBeenCalledExactlyOnceWith(index,2);
  expect(make(null)._toListableItem(episode).title).toBe('Original');
});
