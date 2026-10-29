const DEFAULTS = Object.freeze({
  width: 1000,
  height: 600,
  secondsPerViewport: 14,
  margin: 160,
  playerX: 240,
});

const PROJECTED_TYPES = new Set([
  'lower-terrain', 'upper-terrain', 'corridor', 'lava', 'checkpoint', 'finish',
]);

const round = (value) => Math.round(value * 100) / 100;

export function projectCourseWindow(course, courseTime, options = {}) {
  const view = { ...DEFAULTS, ...options };
  const unitsPerSecond = view.width / view.secondsPerViewport;
  const xForTime = (time) => view.playerX + (Number(time) - Number(courseTime || 0)) * unitsPerSecond;
  const visible = (startX, endX = startX) => endX >= -view.margin && startX <= view.width + view.margin;

  const segments = (course?.segments || [])
    .filter((segment) => PROJECTED_TYPES.has(segment.type))
    .map((segment) => {
      const x = xForTime(segment.start_s);
      const endX = xForTime(segment.end_s ?? segment.start_s);
      return {
        ...segment,
        ...(segment.profile ? { profilePoints: segment.profile.map(p => ({ x: round(xForTime(p.at_s)), y: round(Number(p.altitude) * view.height) })) } : {}),
        x: round(x),
        width: round(Math.max(0, endX - x)),
      };
    })
    .filter((segment) => visible(segment.x, segment.x + segment.width));

  const collectibles = (course?.segments || [])
    .filter((segment) => segment.type === 'collectible-path')
    .flatMap((segment) => segment.collectibles || [])
    .map((item) => ({
      id: item.id,
      x: round(xForTime(item.at_s)),
      y: round(Number(item.altitude) * view.height),
      altitude: Number(item.altitude),
    }))
    .filter((item) => visible(item.x));

  const entities = (course?.entities || [])
    .map((entity) => {
      const x = xForTime(Number(entity.at_s) - Number(entity.width_s) / 2);
      const width = Number(entity.width_s) * unitsPerSecond;
      const height = Number(entity.height) * view.height;
      return {
        ...entity,
        x: round(x),
        y: round(Number(entity.altitude) * view.height - height),
        width: round(width),
        height: round(height),
      };
    })
    .filter((entity) => visible(entity.x, entity.x + entity.width));

  return { ...view, unitsPerSecond, segments, collectibles, entities };
}
