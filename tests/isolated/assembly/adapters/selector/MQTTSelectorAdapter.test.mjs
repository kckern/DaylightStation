import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MQTTSelectorAdapter } from '#adapters/hardware/mqtt-selector/MQTTSelectorAdapter.mjs';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const SELECTORS = [
  {
    id: 'niceday_rider_selector',
    mqtt_topic: 'zigbee2mqtt-usb/Garage Cycling Selector',
    equipment: 'niceday',
    buttons: { '1_single': 'user_2', '2_single': 'user_3', '3_single': 'user_1', '4_single': 'user_4' },
  },
];

function makeAdapter() {
  return new MQTTSelectorAdapter(
    { host: 'mosquitto', port: 1883 },
    { selectors: SELECTORS, logger }
  );
}

describe('MQTTSelectorAdapter', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe('constructor', () => {
    it('does not replay a retained button press on reconnect', () => {
      const handlers=new Map(),onSelect=vi.fn(),client={on:vi.fn((name,fn)=>{handlers.set(name,fn);return client}),end:vi.fn()};
      const adapter=new MQTTSelectorAdapter({host:'mqtt'},{selectors:SELECTORS,logger,onSelect,connect:()=>client});
      try{
        adapter.init();
        handlers.get('message')(SELECTORS[0].mqtt_topic,Buffer.from(JSON.stringify({action:'1_single'})),{retain:true});
        expect(onSelect).not.toHaveBeenCalled();
        handlers.get('message')(SELECTORS[0].mqtt_topic,Buffer.from(JSON.stringify({action:'1_single'})),{retain:false});
        expect(onSelect).toHaveBeenCalledOnce();
      }finally{adapter.close()}
    });
    it('resolves published hold events through an existing long-press shortcut', () => {
      const adapter = new MQTTSelectorAdapter({host:'mqtt'},{selectors:[{...SELECTORS[0],buttons:{'2_long':'dad'}}],logger});
      expect(adapter.resolveInput(SELECTORS[0].mqtt_topic,{action:'2_hold'})).toMatchObject({userId:'dad',action:'2_hold'});
    });
    it('keeps arbitrary mapped party-game inputs and rejects unmapped gestures', () => {
      const adapter = new MQTTSelectorAdapter({ host: 'mqtt' }, { selectors: [{ id: 'buzz', equipment: 'party-games', mqtt_topic: 'party', buttons: { '8_single': 'team8' } }], logger });
      expect(adapter.resolveInput('party', { action: '8_single' })).toMatchObject({ userId: 'team8' });
      expect(adapter.resolveInput('party', { action: '2_double' })).toBeNull();
    });
    it('reports configured when host and selectors are present', () => {
      expect(makeAdapter().isConfigured()).toBe(true);
    });
    it('reports not configured when host is missing', () => {
      const a = new MQTTSelectorAdapter({ host: '' }, { selectors: SELECTORS, logger });
      expect(a.isConfigured()).toBe(false);
    });
    it('reports not configured when selectors list is empty', () => {
      const a = new MQTTSelectorAdapter({ host: 'mosquitto' }, { selectors: [], logger });
      expect(a.isConfigured()).toBe(false);
    });
  });

  describe('resolveSelection', () => {
    let adapter;
    beforeEach(() => { adapter = makeAdapter(); });

    it('delivers unmapped physical gestures without fabricating an assignment', () => {
      const topic = SELECTORS[0].mqtt_topic;
      for (const action of ['1_single', '2_long', '3_hold', '4_double']) {
        expect(adapter.resolveInput(topic, { action })).toMatchObject({ selectorId: 'niceday_rider_selector', equipmentId: 'niceday', action });
      }
      expect(adapter.resolveInput(topic, { action: '4_double' }).userId).toBeUndefined();
      expect(adapter.resolveInput(topic, { action: '9_long' })).toBeNull();
      expect(adapter.resolveInput(topic, { action: '' })).toBeNull();
      expect(adapter.resolveInput('unknown', { action: '1_single' })).toBeNull();
    });

    it('maps a known single-press action to a rider claim', () => {
      const sel = adapter.resolveSelection(
        'zigbee2mqtt-usb/Garage Cycling Selector',
        { action: '2_single' }
      );
      expect(sel).toEqual({
        selectorId: 'niceday_rider_selector',
        equipmentId: 'niceday',
        userId: 'user_3',
        action: '2_single',
      });
    });

    it('returns null for an unmapped gesture (double/hold)', () => {
      expect(adapter.resolveSelection('zigbee2mqtt-usb/Garage Cycling Selector', { action: '2_double' })).toBeNull();
      expect(adapter.resolveSelection('zigbee2mqtt-usb/Garage Cycling Selector', { action: '2_hold' })).toBeNull();
    });

    it('returns null for the empty reset action', () => {
      expect(adapter.resolveSelection('zigbee2mqtt-usb/Garage Cycling Selector', { action: '' })).toBeNull();
    });

    it('returns null for an unconfigured topic', () => {
      expect(adapter.resolveSelection('zigbee2mqtt-usb/Some Other Device', { action: '1_single' })).toBeNull();
    });

    it('returns null when payload has no action', () => {
      expect(adapter.resolveSelection('zigbee2mqtt-usb/Garage Cycling Selector', { battery: 100 })).toBeNull();
    });
  });

  describe('getStatus', () => {
    it('returns configured/connected/topics', () => {
      const status = makeAdapter().getStatus();
      expect(status.configured).toBe(true);
      expect(status.connected).toBe(false);
      expect(status.topics).toEqual(['zigbee2mqtt-usb/Garage Cycling Selector']);
    });
  });
});
