# Resolver and build projection inventory

Status: exact configuration surfaces and their future disposition are selected;
no resolver, manifest, lockfile, build, watcher, or editor file has changed.

The machine record enumerates root/backend/frontend Node scope and locks, twelve
future facet manifests, Vite, Vitest, both Jest configurations, Sass, discovery,
watching, editor settings, Docker context/entrypoint, and native/lock closure.
It also records each selected workspace path and named acceptance gate.

The migration is deliberately native-package-first: public `@daylight/*`
entries must resolve through installed workspace exports. Existing aliases remain
only while their unmigrated source survives; no new mapper may point a public
package name at a private source path. Browser resolution dedupes React and the
selected Mantine packages, while root-canvas aliasing remains explicitly
test-only. The Vite filesystem allow list is limited to the four named workspace
source roots, never the repository root.

Docker must receive the facet manifests before installation and the selected
source roots afterward, while retaining its canvas build prerequisites, font
closure and entrypoint behavior. All three locks change atomically only after
the canvas version/ABI issue is adjudicated. The detailed source patch, clean
install, browser build, watcher, editor and image proof remain later gates.
