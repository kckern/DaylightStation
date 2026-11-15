const logger = { child: () => logger, debug() {}, info() {}, warn() {}, error() {}, sampled() {} };
export default () => logger;
export const DaylightImagePath = () => 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="64" height="64"%3E%3Crect width="64" height="64" fill="%2339448f"/%3E%3C/svg%3E';
export const DaylightMediaPath = (path) => path;
export const DaylightAPI = () => { throw new Error('Skyline layout fixture must not call the backend'); };
