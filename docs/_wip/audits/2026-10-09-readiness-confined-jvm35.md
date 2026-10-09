# Confined bridge JVM unit lane

The fixed lane executes the unchanged 35 `KioskSettingsGuardTest` assertions against original main commit `10d8d2107d5146bf7b147c5433c6f04b5072c777` and the mapped candidate source. The real compile closure includes 28 product classes and the test. No product stubs or rewritten assertions are used.

Run from the application-modules checkout:

```sh
node tests/preimplementation/application-modules/tooling/run-reviewed-jvm35.mjs --execute-reviewed-jvm35
```

There are no caller-selected classes, paths, flags, classpaths or downloads. The adjacent selection and bundle manifests fix source hashes, compiler/runtime identities and cached dependencies. Candidate HEAD is recorded at admission and must stay unchanged throughout the pair; every selected candidate source must match its reviewed hash. Source or dependency changes require reviewed pin renewal. Runtime paths are deliberately exact: a different installation fails admission rather than gaining broad grants.

The parent builds a fixed sibling C launcher with installed, pinned cc/as/ld. Each Java phase receives Landlock and the existing `filter(0,0)`: protected inputs read-only, writes confined to fresh scratch, no outbound sockets or child processes, bounded resources, and no inherited Java option environment. Only the already-pinned ELF interpreter gains execution; installed zlib and JRE timezone data have exact read grants. The launcher validates concrete socket/fork `EPERM` and protected-write `EACCES`.

The trusted Java observer checks scratch writes, protected-source write denial, denied fixed process launch, exact failure/ignore controls, and all 35 names starting and finishing once. Missing reports, failures, skips, assumptions, tampered inputs/classes, startup problems and incomplete runs fail closed. The installed JDK's networking initializer is denied before connect: the report records `networkInitializationDenied=true`, `outboundConnectExercised=false`, `connectionDenied=false`. This branch is accepted only for the precise observed initializer/IOException/native-frame chain; unrelated errors fail. No outside-sentinel read control is implemented.

The private reviewed proof passed original 35/35 and candidate 35/35, with zero failures, skips or assumptions, all controls and protected-input checks true: `/tmp/readiness-jvm35-n3qOdT/receipt.json`. Seven unsuccessful preparation/runtime attempts remain preserved under `/tmp/readiness-jvm-execution/`. The independently reviewed durable checkout invocation also passed original 35/35 and candidate 35/35, with all controls and protected inputs unchanged: `/tmp/readiness-jvm35-og648W/receipt.json`. Node syntax validation passed; no existing confinement helper or product source was changed.

This is relative JVM unit evidence only. Compilation uses `-source 11 -target 11` on pinned JRE21 because `ct.sym` is absent: Java11 syntax/bytecode, not Java11 API compatibility. Both roles share the exact cached Android unit-stub jar of unverified origin. The proof does not certify API33, an Android build, physical devices or broader cutover readiness; those gates remain open. It adds no API comparison coverage.
