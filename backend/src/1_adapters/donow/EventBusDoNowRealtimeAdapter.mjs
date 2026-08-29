import { IDoNowRealtimeGateway } from '#apps/donow/ports/IDoNowRealtimeGateway.mjs';

/** Maps DoNow's semantic realtime capability to the existing event-bus wire contract. */
export class EventBusDoNowRealtimeAdapter extends IDoNowRealtimeGateway {
  #eventBus;

  constructor({ eventBus } = {}) {
    super();
    if (!eventBus) throw new Error('EventBusDoNowRealtimeAdapter requires eventBus');
    this.#eventBus = eventBus;
  }

  observeMidiActivity(handler) {
    return this.#eventBus.subscribe('midi', handler);
  }

  observePlaybackActivity(handler) {
    return this.#eventBus.subscribe('playback.log', handler);
  }

  publishDispatchCompleted({ ref, surface, requestedBy, approvalId = null }) {
    const payload = { type: 'donow.dispatched', ref, surface, requestedBy };
    if (approvalId != null) {
      payload.approved = true;
      payload.approvalId = approvalId;
    }
    this.#eventBus.broadcast('donow', payload);
  }

  launchFitness({ learnerId, episodeId, schoolActivity }) {
    this.#eventBus.broadcast('fitness', {
      type: 'fitness.launch', learnerId, episodeId,
      ...(schoolActivity ? { schoolActivity } : {}),
    });
  }

  launchPiano({ deviceId, contentId, play }) {
    this.#eventBus.broadcast('kiosk.launch', {
      topic: 'kiosk.launch',
      deviceId,
      contentId,
      type: 'piano.launch',
      ...(play ? { play } : {}),
    });
  }

  launchPianoCourseLesson(command) {
    this.#eventBus.broadcast('kiosk.launch', {
      topic: 'kiosk.launch',
      deviceId: command.deviceId,
      type: 'piano.course-lesson.launch',
      learnerId: command.learnerId,
      courseId: command.courseId,
      courseTitle: command.courseTitle ?? null,
      unitId: command.unitId ?? null,
      unitTitle: command.unitTitle ?? null,
      lessonId: command.lessonId,
      lessonTitle: command.lessonTitle ?? null,
    });
  }

  launchSchool({ learnerId, target }) {
    this.#eventBus.broadcast('school', { type: 'school.launch', learnerId, target });
  }
}

export default EventBusDoNowRealtimeAdapter;
