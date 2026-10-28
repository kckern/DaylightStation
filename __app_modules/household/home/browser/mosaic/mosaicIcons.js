import {
  IconBattery2, IconBolt, IconBulb, IconDeviceTv, IconDoor, IconDroplet, IconGauge,
  IconPlug, IconPoint, IconPropeller, IconTemperature, IconToggleRight, IconWalk, IconWindow,
} from '@tabler/icons-react';

/** The one glyph a square carries: what kind of device it is. */
export function iconFor(entity) {
  switch (entity.type) {
    case 'light': return IconBulb;
    case 'power': return entity.domain === 'switch' ? IconPlug : IconBolt;
    case 'presence': return IconWalk;
    case 'openings': return entity.deviceClass === 'window' ? IconWindow : IconDoor;
    case 'climate':
      // Fans are filed under climate; a fan is not a thermometer.
      if (entity.domain === 'fan') return IconPropeller;
      return entity.deviceClass === 'humidity' ? IconDroplet : IconTemperature;
    case 'media': return IconDeviceTv;
    case 'battery': return IconBattery2;
    case 'switch': return IconToggleRight;
    case 'sensor': return IconGauge;
    default: return IconPoint;
  }
}

export default iconFor;
