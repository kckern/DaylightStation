# Media Stable-Core Release Evidence

The isolated stable-core candidate was certified before integration into the newer `main` branch. The merged tree must repeat the exact-SHA runtime and deployment gates before release.

candidate_sha: `25ebdcd52debe8839d53915395983e393813e52b`
candidate_clean_status: `empty`
candidate_artifact_sha256: `21ba05eed9326d4b727467048f327574ace5a506cc9f670435f3ea93d20e8cfb`
candidate_unit_gate: `15/15 passed`
candidate_runtime_gate: `11 accepted stories, 32 criteria, 1 supporting partial story; 12/12 invocations passed`
candidate_runtime_evidence: `/tmp/daylight-media-stable-core-evidence/25ebdcd52debe8839d53915395983e393813e52b/runtime/`
repository_test_gate: `passed; 37,678 tests observed, zero failures`
repository_build_gate: `passed`
frontend_lint_baseline: `35 pre-existing errors outside this candidate`
integration_runtime_gate: pending
deploy_gate: pending
budget_checkpoint: `40% of weekly allowance used; hard ceiling 50%`
