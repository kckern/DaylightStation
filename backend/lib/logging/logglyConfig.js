// Centralized Loggly config resolver (DRY)
// Do not duplicate token lookups in individual modules.

export const getLogglyConfig = (overrides = {}) => {
  const token = process.env.LOGGLY_TOKEN || process.env.LOGGLY_INPUT_TOKEN;
  const subdomain = process.env.LOGGLY_SUBDOMAIN;
  const tags = overrides.tags || ['backend'];
  return { token, subdomain, tags };
};

export default getLogglyConfig;
