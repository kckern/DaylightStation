/**
 * @deprecated Import from '#domains/media/ports/IMediaQueueDatastore.mjs' instead.
 *
 * Port interfaces belong in the domain layer (2_domains) so both adapters and
 * application services can depend on them without violating the dependency rule.
 * This re-export exists only for backward compatibility.
 */
export { IMediaQueueDatastore, default } from '#domains/media/ports/IMediaQueueDatastore.mjs';
