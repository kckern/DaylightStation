/** Inject into owner routers; HTTP identity resolution stays outside policy evaluation. */
export function createSupervisedIngress({guard,resolveContext}){
  return async request=>guard.authorize(await resolveContext(request));
}
