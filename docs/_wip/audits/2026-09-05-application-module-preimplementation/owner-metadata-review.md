# Proposed owner metadata schema

Status: schema-only; it does not create an `owner.json`, package, command, or
runtime activation. The [machine review](owner-metadata-review.json) validates
the proposed Gratitude and household-identity descriptors against required
metadata fields.

An owner record must identify a unique owner/category/root; non-overlapping
facets; scoped subowners; domain contexts/ranks; narrow public entries; and
references to test, development, and satellite/external-target evidence. Public
entries are descriptive and retain their layer/runtime/contract/closure rules.

It must not contain start/stop commands, scripts, environment values, ports,
credentials, deployment, or autostart behavior. Actual owner files, package
manifests, contributor targets, runners, and build integration remain explicit
future cards. Metadata cannot make a module importable, start a service, or
approve a package boundary.
