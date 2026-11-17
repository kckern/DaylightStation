import { pushData } from '#domains/notification/push/pushText.mjs';

export function composeFitnessTransportPush(incident) {
  return {
    title: 'Fitness sensors disconnected',
    message: 'Fitness has stopped receiving sensor readings. Automatic connection recovery has not restored them. Check the sensor bridge and the workout screen.',
    data: pushData({ tag: `fitness-transport-${incident.incidentId}`, channel: 'Household alerts', importance: 'high' }),
  };
}
