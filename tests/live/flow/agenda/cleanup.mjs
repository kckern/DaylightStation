/** Attempt independent fixture-owned cleanup operations even if another fails. */
export async function attemptCleanup(steps) {
 const failures=[];
 for (const step of steps) {try {await step();} catch(error) {failures.push(error);}}
 if (failures.length) throw new AggregateError(failures,'Fixture cleanup failed');
}
/** Preserve the journey error when cleanup also fails. */
export async function withCleanup(work,cleanup) {
 let failure;
 try {return await work();} catch(error) {failure=error;throw error;}
 finally {
  try {await cleanup();} catch(error) {
   if (!failure) throw error;
   if (failure && typeof failure==='object') failure.cleanupError=error;
  }
 }
}
