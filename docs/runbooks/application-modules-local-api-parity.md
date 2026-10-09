The runner boots the actual assembled application with a disposable synthetic data directory. It uses the existing Landlock and seccomp launcher, permitting only TCP bind on port 43129. The audited driver listens on 127.0.0.1. Outbound TCP connections and standalone Unix sockets remain denied; existing anonymous IPC is preserved. Landlock limits the port, not the bind address.

Run the transport and filesystem controls first:

```sh
node tests/readiness/application-modules/run-local-app.mjs \
  --source-root /absolute/candidate \
  --tool-root /absolute/installed-dependencies \
  --output-root /absolute/private-output-directory \
  --controls-only
```

For reviewed application cases, replace `--controls-only` with both `--manifest /absolute/expectations.json` and `--targets /absolute/targets.json`. The comparator validates safety dispositions and explicit target identities before requests. There is no default live target. The candidate target must name the actual HEAD and this task's listener. A stable fingerprint of relative source paths and bytes distinguishes uncommitted changes; execution input hashes record the runner, driver, comparator, expectations, target declarations, fixture and launcher separately.

The default fixture has synthetic credentials and empty provider, device and integration configuration. `--fixture /absolute/fixture.json` permits an explicitly prepared disposable fixture; protected startup configuration must remain synthetic. Source and canonical dependencies are read-only. Production entrypoint, private source files and live writable data mounts are excluded.

The listener lasts 30 seconds with a 75-second outer wall bound. Divide reviewed cases into small packs that finish within that window. Reports and raw comparison bodies remain private in the output directory. A completed boot is separate from accepted comparisons; neither accepts whole-application readiness. The process exits deliberately after the bounded observation and does not prove natural shutdown, production jobs, denied-role authentication, Docker packaging or browser behavior.

Prepare the private source-derived projection from an explicit data root and a new, existing output directory outside the data tree:

```sh
node tests/readiness/application-modules/project-readonly-fixture.mjs \
  --data-root /absolute/read-only-data \
  --output-root /absolute/new-private-projection \
  --base-manifest /absolute/candidate/tests/readiness/application-modules/first-readonly-expectations.json
```

The generator writes `fixture.json`, `source-contract-inputs.json`, `provenance.json`, `expectations.json` and `next-readonly-expectations.json` with mode 0600 in a mode 0700 directory, refusing existing artifacts. It records backing file hashes, inode/device identities and missing alternatives before projection and checks them again before writing. Validate the same provenance before and after the HTTP pack; changed backing files or absence states invalidate that pack's data relationship.

The initial manifest adds School roster, Health context, disabled Piano budget and Gratitude users to the three authored cases. The next manifest covers the head member's Health and Lifelog weight, Finance budgets/memos/pairs and Piano roster. Expectations come from reviewed source contracts and backing inputs. Finance copies only budget response fields from compiled finances, plus the memo and pair files; mortgage, per-period transaction history, providers and credentials stay outside the fixture. Permitted YAML array roots are the reviewed Finance transaction-pairs and Gratitude selections/discarded files; startup restrictions still apply.

These are selected projections into an independent snapshot. The generator records uncovered empty/absent weight or enabled Piano history branches; it does not supply expected responses for them. It requires populated School learners and a configured density table. Each successful case covers its observed branch, with missing data, invalid inputs, authenticated roles and alternate configuration branches still requiring separate cases. Health daily/longitudinal and Gratitude bootstrap/options remain excluded because their GET handlers can write.

The outer process bound includes application construction as well as the 30-second listener. Two six-case attempts passed comparisons but reached the former 45-second process bound with SIGKILL. The 75-second bound provides room for construction while keeping the listener and all other isolation/resource limits unchanged; failed receipts remain evidence.

`extended-readonly-expectations.json` adds eleven finite reads: head-member Health workouts/fitness/nutrition/coaching, guest Chess config/ladder, Gratitude selections/discarded/snapshot list, and head-member Piano preferences/preset. Health files and populated Piano config are projected from their exact reviewed backing files. Gratitude copies serialized item fields, and snapshot fixtures retain only id/creation metadata; directory entries and absent snapshot directories are protected by provenance checks. Only reviewed Gratitude selections/discarded array roots join Finance pairs in the runner allowlist.

Chess guest expectations use the authored configuration and pure roster/policy contracts; the generator independently builds fresh guest progress, promotion status and standing without calling the API or application service. Requests omit the user query and therefore do not read/write ladder history. The generator labels each added case's observed populated or empty branch, preserving a populated-data gap for an absent snapshot directory. These cases exercise no engine moves, printing, bootstrap/options recycling or provider calls.
