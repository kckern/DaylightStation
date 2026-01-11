/**
 * AdapterRegistry - Typed sub-registries for adapter lookup
 *
 * Provides typed access to adapters without exposing concrete implementations.
 * Application layer uses interfaces: registry.content.resolve(compoundId)
 *
 * @see docs/_wip/plans/2026-01-10-backend-ddd-architecture.md
 */

// TODO: class ContentSourceRegistry - IContentSource implementations
// TODO: class MessagingRegistry - IMessagingPlatform implementations
// TODO: class AIProviderRegistry - IAIProvider implementations

// TODO: class AdapterRegistry {
//   content: ContentSourceRegistry;
//   messaging: MessagingRegistry;
//   ai: AIProviderRegistry;
// }

export {};
