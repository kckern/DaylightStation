# Gratitude integration seam ownership

Status: every selected incoming/outgoing Gratitude seam has an owner, public
contract, concrete cases, and explicit non-permissions. No source or runtime
registration has changed.

The seam review divides responsibility into public surfaces, consumer bridges,
and installed contracts. Gratitude provides narrow composition-returned query
and command operations; Feed retains bundle policy and Homebot retains its own
gateway port/adapter. Household identity remains a separate capability with a
presentation query and browser roster client, never a Gratitude datastore
shortcut.

The installed application remains the sole activation authority: it creates the
service graph, mounts the existing router, retains printer registry/canvas
injection, and owns app registry/Admin mappings. Public entries preserve these
bindings without adding routes, app enablement, devices, controllers, or new
storage authority. The event entry contains only `GratitudeEvents`; the mixed
publication barrel and all unrelated classes stay outside the product boundary.
