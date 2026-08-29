/** YAML boundary projection for legacy lifelog/health records. */
export function dehydrateWorkoutRecord(workout) {
  const result = {
    source: workout.source,
    title: workout.title,
    type: workout.type,
    duration: workout.duration,
    calories: workout.calories,
  };
  if (workout.avgHr) result.avgHr = workout.avgHr;
  if (workout.maxHr) result.maxHr = workout.maxHr;
  if (workout.distance) result.distance = workout.distance;
  if (workout.startTime) result.startTime = workout.startTime;
  if (workout.endTime) result.endTime = workout.endTime;
  if (workout.strava) result.strava = workout.strava;
  if (workout.fitness) result.fitness = workout.fitness;
  return result;
}

export function dehydrateHealthMetricRecord(metric) {
  if (!metric || typeof metric.getWorkoutSummary !== 'function') return metric;
  const summary = metric.getWorkoutSummary();
  return {
    date: metric.date,
    weight: metric.weight,
    nutrition: metric.nutrition,
    steps: metric.steps,
    workouts: metric.workouts.map(dehydrateWorkoutRecord),
    summary: {
      total_workout_calories: summary.totalCalories,
      total_workout_duration: summary.totalDuration,
    },
    coaching: metric.coaching,
  };
}

export function dehydrateHealthDataRecord(healthData) {
  return Object.fromEntries(Object.entries(healthData || {}).map(
    ([date, metric]) => [date, dehydrateHealthMetricRecord(metric)],
  ));
}
