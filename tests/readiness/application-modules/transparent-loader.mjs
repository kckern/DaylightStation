export const resolve = (specifier, context, nextResolve) => nextResolve(specifier, context);
export const load = (url, context, nextLoad) => nextLoad(url, context);
