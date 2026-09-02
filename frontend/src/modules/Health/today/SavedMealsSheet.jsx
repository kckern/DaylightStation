import { UnstyledButton, Text } from '@mantine/core';
import { Sheet, LoadingState, EmptyState } from '@/lib/ui';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('saved-meals');
const kcal = (meal) => Math.round(meal.items.reduce((s, i) => s + (Number(i.calories) || 0), 0));

/** Picker sheet over saved meal templates — tap one to log it into the given bucket. */
export function SavedMealsSheet({ open, onClose, onLogged, bucketId }) {
  const { data, loading } = useApiResource(open ? 'api/v1/health/nutrition/meals' : null, { deps: [open], label: 'saved-meals', logger });
  const meals = data?.meals || [];

  const log = async (meal) => {
    try {
      await DaylightAPI(`api/v1/health/nutrition/meals/${meal.id}/log`, { mealTime: bucketId }, 'POST');
      logger.info('meal.logged', { id: meal.id });
      onLogged();
    } catch (err) {
      logger.error('meal.log_failed', { id: meal.id, error: err?.message });
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Saved meals">
      {loading ? <LoadingState label="saved meals" /> : null}
      {!loading && meals.length === 0 ? (
        <EmptyState title="No saved meals yet" hint="Save one from any logged item's edit sheet." />
      ) : null}
      {meals.map((meal) => (
        <UnstyledButton key={meal.id} className="health-suggest__item" onClick={() => log(meal)}>
          <span>{meal.name}</span>
          <Text size="xs" c="dimmed" ml="auto">{meal.items.length} items · {kcal(meal)} kcal</Text>
        </UnstyledButton>
      ))}
    </Sheet>
  );
}
export default SavedMealsSheet;
