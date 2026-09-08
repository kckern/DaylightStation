# Prospective package topology

Status: selected topology only; no workspace or manifest exists yet.

The machine review derives 57 approved public subpaths across platform,
Gratitude, household identity, Admin, and declarative contracts. Platform,
Gratitude, and household identity each keep a non-package owner directory with
three sibling workspaces: `public`, `server`, and `web`. Admin has only public
and web facets because no selected Admin server entry exists. The declarative
contracts catalog is the narrowly documented single-facet exception: it exposes
data only and has no private implementation facet.
The public facet forwards narrow declared subpaths to the matching internal
facet. All selected facet packages are private local workspaces; no wildcard
exports, ancestor workspace, nested facet package, or cross-owner private
import is permitted.

The later manifest card must implement the reviewed names and subpaths exactly,
then prove sibling discovery, private-subpath rejection, and missing-export
rejection with the named package cases. Dependency versions, peers, resolver
projections, lockfile changes, and install/build behavior remain separate gates.
