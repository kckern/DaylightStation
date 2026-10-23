import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// outDir: where screenshots go; the caller (fitness-sidebar-layout.mjs) passes its
// per-run directory. Standalone callers get a fresh fitness-harness-XXXXXX temp dir.
export async function verifyIntegration(page,evidence,engine,outDir=mkdtempSync(join(tmpdir(),'fitness-harness-'))) {
  const render=options=>page.evaluate(options=>window.renderIntegration(options),options);
  const settle=()=>page.waitForTimeout(650);
  const settledProgress=async()=>{
    const handle=await page.waitForFunction(()=>{
      const bars=[...document.querySelectorAll('.governance-lock__progress-track')].map(track=>{
        const fill=track.querySelector('.governance-lock__progress-fill');
        const label=track.querySelector('.governance-lock__progress-indicator').textContent;
        const trackRect=track.getBoundingClientRect();const fillRect=fill.getBoundingClientRect();
        const transform=getComputedStyle(fill).transform;
        return {label,percent:Number(label.replace('%','')),track:trackRect.toJSON(),fill:fillRect.toJSON(),
          fraction:fillRect.width/trackRect.width,scale:new DOMMatrixReadOnly(transform).a,transform,
          animating:fill.getAnimations().some(animation=>animation.playState==='running'||animation.pending)};
      });
      return bars.length>0&&bars.every(bar=>Number.isFinite(bar.percent)&&bar.track.width>0&&!bar.animating
        &&Math.abs(bar.fraction-bar.percent/100)<0.001&&Math.abs(bar.scale-bar.percent/100)<0.001
        &&Math.abs(bar.fill.right-(bar.track.left+bar.track.width*bar.percent/100))<0.75)?bars:false;
    },undefined,{timeout:3000,polling:'raf'});
    const bars=await handle.jsonValue();await handle.dispose();return bars;
  };
  const assertPaintedProgress=(bars,expected)=>{
    assert.deepEqual(bars.map(bar=>bar.percent),expected,'painted progress labels');
    bars.forEach((bar,index)=>{
      assert.ok(Math.abs(bar.fraction-expected[index]/100)<0.001,'painted fill fraction '+JSON.stringify(bar));
      assert.ok(Math.abs(bar.scale-expected[index]/100)<0.001,'computed fill scale '+JSON.stringify(bar));
      assert.ok(Math.abs(bar.fill.left-bar.track.left)<0.75,'fill anchored at track start '+JSON.stringify(bar));
      assert.ok(Math.abs(bar.fill.right-(bar.track.left+bar.track.width*expected[index]/100))<0.75,'painted fill endpoint '+JSON.stringify(bar));
    });
  };
  const screenshot=label=>page.screenshot({path:join(outDir,`${engine}-${label}.png`)});
  const allActive=count=>Object.fromEntries(Array.from({length:count},(_,i)=>['rider-'+i,'active']));
  for(const viewport of [{width:1920,height:1080},{width:1381,height:777},{width:1024,height:640}]) {
    await page.setViewportSize(viewport);
    await render({reset:true,count:5,rpm:2,challenge:false,target:'active'});
    await settle();
    const parent=await page.evaluate(()=>{
      const rect=sel=>document.querySelector(sel).getBoundingClientRect().toJSON();
      const list=document.querySelector('.fitness-devices');
      const grid=document.querySelector('.device-grid');
      return {viewport:{width:innerWidth,height:innerHeight},frame:rect('.fitness-player-frame'),sidebar:rect('.fitness-sidebar-container'),list:rect('.fitness-devices'),media:rect('.fitness-sidebar-media'),footer:rect('#fixture-footer'),scroll:list.scrollHeight,room:list.clientHeight,
        bottom:Math.max(...[...grid.children].map(e=>e.getBoundingClientRect().bottom)),cards:[...document.querySelectorAll('.fitness-device.heart-rate')].map(e=>e.getBoundingClientRect().height)};
    });
    assert.equal(parent.cards.length,5);
    assert.ok(parent.cards.every(h=>h>=63.5),'readable cards in parent');
    const minimumContent=5*64+(parent.bottom-parent.list.top-parent.cards.reduce((sum,h)=>sum+h,0));
    if(minimumContent<=parent.room) assert.ok(parent.scroll<=parent.room+3,'five cards and RPM fit actual parent '+JSON.stringify(parent));
    else {
      assert.ok(parent.cards.every(h=>Math.abs(h-64)<1),'scroll only at readable minimum');
      const scrolled=await page.locator('.fitness-devices').evaluate(list=>{list.scrollTop=list.scrollHeight;return {last:list.querySelector('.device-grid').lastElementChild.getBoundingClientRect().bottom,bottom:list.getBoundingClientRect().bottom};});
      assert.ok(scrolled.last<=scrolled.bottom+1,'RPM remains reachable at minimum-supported height');
      parent.scrolled=scrolled;
    }
    assert.ok(parent.media.bottom<=parent.sidebar.bottom+1,'media reservation fits');
    assert.ok(parent.media.top-parent.list.bottom<2,'list fills above media');
    assert.ok(Math.abs(parent.list.bottom-(parent.scrolled?.last??parent.bottom))<8,'no parent allocation gap '+JSON.stringify(parent));
    assert.equal(Math.round(parent.footer.height),80);
    assert.equal(Math.round(parent.sidebar.height),viewport.height);
    evidence.push({acceptance:'full-parent',...parent});
    await screenshot(viewport.width+'-parent');

    for(const count of [1,3,5,8]) {
      await render({reset:true,count,rpm:0,challenge:false,target:'fire',showOverlay:true,zones:Object.fromEntries(Array.from({length:count},(_,i)=>['rider-'+i,'cool']))});
      await settle();
      const geometry=await page.evaluate(()=>{
        const table=document.querySelector('.governance-lock__table');const panel=document.querySelector('.governance-lock');
        const rows=[...document.querySelectorAll('.governance-lock__row')];
        const rect=e=>e.getBoundingClientRect().toJSON();
        table.scrollTop=table.scrollHeight;
        return {table:rect(table),panel:rect(panel),scroll:table.scrollHeight,room:table.clientHeight,rows:rows.map(rect),last:rect(rows.at(-1)),holding:/\bHolding\b/.test(panel.innerText)};
      });
      assert.equal(geometry.rows.length,count);
      assert.ok(geometry.panel.top>=-1 && geometry.panel.bottom<=viewport.height-80+1,JSON.stringify(geometry));
      assert.ok(geometry.last.bottom<=geometry.table.bottom+1,'last governance row reachable');
      assert.ok(geometry.rows.every(row=>row.height>=40),'compact readable row');
      assert.ok(!geometry.holding,'no Holding prose');
      if(count===1) assert.ok(geometry.panel.height<250,'no blank reserved rows');
      evidence.push({acceptance:'governance-geometry',viewport,count,...geometry});
      await screenshot(viewport.width+'-governance-'+count);
    }
    // Test actual Settings interaction in the production parent structure.
    await render({reset:true,count:5,challenge:false,target:'active',zones:allActive(5)});
    await page.getByRole('button',{name:'Open settings',exact:true}).click();
    const body=page.locator('.sidebar-menu-content');
    await page.locator('.menu-more summary').click();
    const labels=await page.locator('.touch-volume-button,.boost-btn').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')));
    assert.ok(labels.length>4 && labels.every(Boolean));assert.equal(new Set(labels).size,labels.length,'unique audio labels');
    await body.hover();await page.mouse.wheel(0,1000);await page.waitForTimeout(180);
    assert.ok(await page.getByRole('button',{name:'Send feedback',exact:true}).isVisible());
    const reach=()=>page.evaluate(()=>{
      const body=document.querySelector('.sidebar-menu-content').getBoundingClientRect();const last=document.querySelector('[aria-label="Send feedback"]').getBoundingClientRect();
      const close=document.querySelector('.close-btn').getBoundingClientRect();return {last:last.toJSON(),body:body.toJSON(),close:close.toJSON()};
    });
    let positions=await reach();assert.ok(positions.last.bottom<=positions.body.bottom+1,'wheel reaches final action');
    const wheelPositions=positions;
    await page.getByRole('button',{name:'Close settings',exact:true}).focus();
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Close settings');
    await body.evaluate(element=>{element.scrollTop=0;});
    assert.equal(await body.evaluate(element=>element.scrollTop),0,'keyboard case starts independently at top');
    const maxTabs=await page.locator('.fitness-sidebar-menu button,.fitness-sidebar-menu input,.fitness-sidebar-menu summary').count()+2;
    const keyboardPath=[];
    let keyboardReached=false;
    for(let i=0;i<maxTabs;i++) {
      await page.keyboard.press('Tab');
      const focused=await page.evaluate(()=>({
        label:document.activeElement?.getAttribute('aria-label')||document.activeElement?.textContent?.trim(),
        final:document.activeElement===document.querySelector('[aria-label="Send feedback"]'),
      }));
      keyboardPath.push(focused.label);
      if(focused.final) {keyboardReached=true;break;}
    }
    assert.ok(keyboardReached,'actual Tab traversal reaches Send feedback: '+JSON.stringify(keyboardPath));
    assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('[aria-label="Send feedback"]')),true);
    positions=await reach();
    const keyboardPositions=positions;
    assert.ok(positions.last.top>=positions.body.top-1&&positions.last.bottom<=positions.body.bottom+1,'Tab traversal scrolls final action into content bounds');
    assert.ok(positions.close.top>=0 && positions.close.width>=40 && positions.close.height>=40,'reachable close');
    // Native touch scroll is Chromium evidence; desktop Firefox supplies
    // wheel and keyboard evidence (it does not expose TouchEvent).
    if(engine==='chromium') {
      await page.getByRole('button',{name:'Close settings',exact:true}).focus();
      await body.evaluate(e=>{e.scrollTop=0;});
      const box=await body.boundingBox();
      const cdp=await page.context().newCDPSession(page);
      await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height-15}]});
      for(let i=1;i<=8;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height-15-i*(box.height-30)/8}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await page.waitForTimeout(300);
      positions=await reach();assert.ok(positions.last.bottom<=positions.body.bottom+1,'native touch reaches last Settings action');
      await cdp.detach();
    }
    await page.getByRole('button',{name:'30% volume',exact:true}).click();
    assert.ok(await page.evaluate(()=>window.volumeCount>0),'volume action');
    await page.getByRole('button',{name:'Video boost 5 times',exact:true}).click();
    await page.locator('.toggle-item').filter({hasText:'Webcam'}).click();
    assert.equal(await page.evaluate(()=>window.boostCount), (evidence.filter(e=>e.acceptance==='settings').length+1));
    const endedBefore=await page.evaluate(()=>window.endCount||0);
    await page.getByRole('button',{name:'End current fitness session',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.endCount||0),endedBefore,'confirmation precedes action');
    await page.getByRole('dialog',{name:'End this fitness session?'}).waitFor();
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.getByRole('button',{name:'End current fitness session',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.endCount||0),endedBefore,'cancel preserves session');
    await page.locator('.end-session-confirm-accept').click();
    assert.equal(await page.evaluate(()=>window.endCount||0),endedBefore+1,'accept ends synthetic session');
    assert.equal(await page.locator('.end-session-confirm-modal').count(),0);
    await page.getByRole('button',{name:'Send feedback',exact:true}).click();
    await page.getByRole('dialog',{name:'Feedback',exact:true}).waitFor();
    await page.waitForTimeout(5300);
    assert.equal(await page.getByRole('dialog',{name:'Feedback',exact:true}).count(),1,'real Feedback survives menu idle deadline');
    await screenshot(viewport.width+'-feedback');
    await page.getByRole('button',{name:'Close',exact:true}).click();
    assert.equal(await page.getByRole('dialog',{name:'Feedback',exact:true}).count(),0);
    await page.getByRole('button',{name:'Close settings',exact:true}).click();
    await page.getByRole('button',{name:'Open settings',exact:true}).click();
    await page.locator('.sidebar-menu-overlay').click({position:{x:30,y:30}});
    assert.equal(await page.locator('.fitness-sidebar-menu').count(),0);
    assert.equal(await page.evaluate(()=>window.fullscreenCount||0),0,'scrim does not trigger fullscreen');
    evidence.push({acceptance:'settings',viewport,nativeTouch:engine==='chromium',keyboardPath,wheelPositions,keyboardPositions,positions,feedbackSurvivedMs:5300,endCount:await page.evaluate(()=>window.endCount)});
  }

  await page.getByRole('button',{name:'Open settings',exact:true}).click();
  await page.locator('.menu-more summary').click();
  await Promise.all([page.waitForEvent('framenavigated', {predicate:frame=>frame===page.mainFrame()}),page.getByRole('button',{name:'Hard-reload the app (bypasses cache)',exact:true}).click()]);
  await page.waitForFunction(()=>typeof window.renderIntegration==='function');
  evidence.push({acceptance:'more-reload',origin: new URL(page.url()).origin});

  await page.setViewportSize({width:1381,height:777});
  const heartColors=[];
  for(const zone of ['cool','active','warm','hot','fire',null]) {
    await render({reset:true,count:1,challenge:false,target:'active',zones:{'rider-0':zone}});
    await settle();
    heartColors.push(await page.locator('.fitness-heart-icon').evaluate(el=>({zone:el.closest('.fitness-device').className,color:getComputedStyle(el).color,expected:window.integrationStrapColor})));
  }
  assert.equal(new Set(heartColors.map(c=>c.color)).size,1,'strap heart survives all zones and signal loss');
  assert.equal(heartColors[0].color,'rgb(176, 124, 247)');
  evidence.push({acceptance:'physical-strap-heart',heartColors});
  // Percentage notch positions and personal denominator, through the actual
  // display calculation, independent of the canonical-zone sensor pipeline.
  for(const [hr,percent] of [[70,0],[135,50],[200,100]]) {
    await render({reset:true,count:1,challenge:false,target:'fire',showOverlay:true,zones:{'rider-0':'cool'},heartRates:{'rider-0':hr}});
    const painted=await settledProgress();
    assertPaintedProgress(painted,[percent]);
    const notch=await page.evaluate(()=>{
      const n=document.querySelector('.governance-lock__progress-indicator');const track=n.parentElement;
      return {label:n.textContent,notch:n.getBoundingClientRect().toJSON(),track:track.getBoundingClientRect().toJSON(),meta:document.querySelector('.governance-lock__chip-meta').textContent};
    });
    assert.equal(notch.label,percent+'%');assert.equal(notch.meta,hr+' / 200');
    const expectedLeft=notch.track.left+(notch.track.width-notch.notch.width)*percent/100;
    assert.ok(Math.abs(notch.notch.left-expectedLeft)<1,'notch follows actual percentage '+JSON.stringify(notch));
    assert.ok(notch.notch.left>=notch.track.left-1 && notch.notch.right<=notch.track.right+1,JSON.stringify(notch));
    evidence.push({acceptance:'percentage',percent,painted,...notch});
  }
  await render({reset:true,count:3,challenge:false,target:'fire',showOverlay:true,zones:{'rider-0':'cool','rider-1':'cool','rider-2':'cool'}});
  const palette=await page.evaluate(()=>window.integrationPalette);
  await render({showOverlay:true,zones:{'rider-0':'active','rider-1':'cool','rider-2':'cool'},pedal:true});
  await settle();
  const live=await page.evaluate(()=>{
    const row=[...document.querySelectorAll('.governance-lock__row')].find(e=>e.innerText.includes('Long Participant Name 0'));
    const pills=[...row.querySelectorAll('.governance-lock__pill')];
    return {labels:pills.map(p=>p.textContent),colors:pills.map(p=>getComputedStyle(p).backgroundColor),avatar:row.querySelector('.governance-lock__avatar').className,progress:window.integrationDisplay.rows.find(r=>r.userId==='rider-0'),pedal:row.querySelector('[role="img"]').getAttribute('aria-label'),text:row.innerText};
  });
  assert.deepEqual(live.labels,['Active','Fire']);assert.ok(live.avatar.includes('zone-active'));
  assert.deepEqual(live.colors,['rgba(81, 207, 102, 0.18)','rgba(255, 107, 107, 0.85)']);
  assert.equal(live.progress.currentZone.color,palette.active);assert.equal(live.progress.targetZone.color,palette.fire);
  assert.equal(live.progress.targetHeartRate,200);assert.equal(live.pedal,'Pedal or reach Active');
  assert.ok(!/Holding|Start pedaling/.test(live.text));
  evidence.push({acceptance:'live-palette-pedal',...live});await screenshot('live-palette-pedal');

  // Real failed challenge transitions expose per-person hold in the foreground.
  for(const hold of [0,1,10]) {
    await render({reset:true,count:3,hold,showOverlay:true});
    let result=await render({advance:40001,showOverlay:true});
    assert.equal(result.state.challenge.status,'failed');
    result=await render({zones:{'rider-0':'warm','rider-1':'active','rider-2':'active'},showOverlay:true});
    if(hold>0) {
      result=await render({advance:hold*500,zones:{'rider-0':'warm','rider-1':'warm','rider-2':'active'},showOverlay:true});
      const painted=await settledProgress();
      assertPaintedProgress(painted,[100,100,0]);
      const bars=await page.locator('.governance-hold-progress').evaluateAll(nodes=>nodes.map(e=>({max:e.getAttribute('aria-valuemax'),now:e.getAttribute('aria-valuenow'),text:e.getAttribute('aria-valuetext'),height:e.getBoundingClientRect().height})));
      assert.equal(bars.length,2);assert.equal(Number(bars[0].max),hold*1000);assert.ok(bars.every(b=>b.height<=4));
      assert.deepEqual(bars.map(b=>Number(b.now)).sort((a,b)=>a-b),[0,hold*500]);
      assert.ok(!/\bHolding\b/.test(await page.locator('.governance-lock').innerText()));
      evidence.push({acceptance:'hold',hold,bars,painted});await screenshot('hold-'+hold);
      result=await render({advance:hold*500,showOverlay:true});
    } else assert.equal(await page.locator('.governance-hold-progress').count(),0,'zero hold has no indicator');
    assert.ok(result.state.challenge.metUsers.includes('rider-0'),JSON.stringify({hold,state:result.state.challenge,diagnostics:await page.evaluate(()=>window.integrationDiagnostics)}));
    assert.ok(!result.display.rows.some(r=>r.userId==='rider-0'));
    assert.ok(result.display.metRows.some(r=>r.userId==='rider-0'));
    assert.equal(await page.locator('.governance-lock__credit--met[title="Long Participant Name 0"]').count(),1,'credited rider moves to face');
    evidence.push({acceptance:'credited-migration',hold,state:result.state.challenge});
  }
  for(const failed of [false,true]) {
    await render({reset:true,count:3,hold:10,showOverlay:true});
    if(failed) await render({advance:40001,showOverlay:true});
    let result=await render({zones:{'rider-0':'cool','rider-1':'active','rider-2':'active'},showOverlay:true});
    assert.equal(result.state.challenge.paused,true);assert.equal(result.display.zone,'active');assert.equal(result.display.rows.length,1);
    const remaining=result.state.challenge.remainingSeconds;
    result=await render({advance:60000,showOverlay:true});
    assert.equal(result.state.challenge.remainingSeconds,remaining);assert.equal(result.display.challenge,null);
    assert.equal(result.display.zone,'active');assert.equal(result.state.videoLocked,true);
    assert.ok((await page.locator('.governance-lock__summary-main').innerText()).includes('Active'));
    assert.equal(await page.locator('.governance-hold-progress').count(),0);
    await screenshot('floor-'+(failed?'failed':'pending'));
    result=await render({zones:allActive(3),showOverlay:true});
    assert.equal(result.state.challenge.id,'acceptance-challenge');assert.equal(result.state.challenge.paused,false);
    assert.equal(result.state.challenge.remainingSeconds,remaining);
    assert.equal(result.state.challenge.status,failed?'failed':'pending');
    if(failed) {assert.equal(result.display.zone,'warm');assert.equal(result.state.videoLocked,true);}
    else assert.equal(result.display.show,false);
    evidence.push({acceptance:'floor-background-resume',failed,state:result.state.challenge,display:result.display});
  }
}
