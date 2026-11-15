import {it,expect} from 'vitest';
import {calibrateGratitude} from './gratitude-calibrate.mjs';
it('fails calibration for a false penalty and records every synthetic case',async()=>{
  const report=await calibrateGratitude({judge:{assess:async()=>({verdict:'nonsense',model:'test',confidence:.99,rubricVersion:1})},cases:[{id:'valid-short',text:'Toys',expected:'eligible',history:[]}]});
  expect(report.passed).toBe(false);expect(report.falsePenalties).toBe(1);expect(report.results).toHaveLength(1);
});
