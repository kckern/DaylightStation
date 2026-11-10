import { createAppLogger } from '@/lib/ui';

/** The home app's one structured logger (createAppLogger is once per app module). */
export const homeLogger = createAppLogger('home');

export default homeLogger;
