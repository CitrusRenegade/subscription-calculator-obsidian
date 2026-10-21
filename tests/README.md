## Commands

| Command | Checks |
| --- | --- |
| `npm test` | Test typecheck and Vitest suites |
| `npm run check` | Tests, build, Obsidian/CSS lint and manifest |
| `npm run test:regressions` | Baseline tests, then ten deliberately broken variants; source files stay unchanged |
| `npm run smoke:native` | Opt-in checks in real Obsidian; separate from headless checks and CI |

For shuffled tests, run the typecheck first, then `npx vitest run --sequence.shuffle --sequence.seed=42`.

## Test boundaries

- Node tests cover money, dates, migrations, persistence, CLI and icon races.
- jsdom tests use actual UI components with the Obsidian adapter in `helpers/obsidianDom.ts`. Plugin API tests use `obsidianMock.ts`.
- Shared fixtures live in `helpers/storeFixture.ts` and `helpers/subscriptionFactory.ts`; deferred operations and timers use `helpers/deferred.ts` and `helpers/timers.ts`. Settle owned operations before disposing stores or resetting timers.
- Headless tests do not prove native focus, layout, settings popouts or plugin reload behavior.

## Native smoke

The runner checks the exact vault and loaded plugin, records versions, revision and artifact hashes, and writes `report.md` plus `evidence/*.png` outside the repository.

Requirements: a visible, unminimized test window and a painting renderer. OS foreground focus is diagnostic; focus-sensitive steps check the actual input. Renderer screenshots do not prove desktop exposure through overlapping windows.

### Configuration and execution

Read machine settings from local `AGENTS.md`. Pass flags or environment variables explicitly; the runner does not parse that file or assume a machine target. Flags take precedence.

| Flag | Environment |
| --- | --- |
| `--vault-name` | `SMOKE_NATIVE_VAULT_NAME` |
| `--vault-path` | `SMOKE_NATIVE_VAULT_PATH` |
| `--cdp-endpoint` | `SMOKE_NATIVE_CDP_ENDPOINT` |
| `--display` | `SMOKE_NATIVE_DISPLAY` |

The first three are required. Display is required for placement; `--skip-place` preserves an independently verified fitting window. Placement fractions default to 0.72/0.87. Use `--placement-helper` for a devkit helper outside the auto-discovered Claude cache.

Optional: `--plugin-id` defaults to the manifest; `--report-dir` defaults to `../subscription-calculator-smoke-runs`. Their environment equivalents are `SMOKE_NATIVE_PLUGIN_ID` and `SMOKE_NATIVE_REPORT_DIR`.

1. Launch the configured vault with its CDP port if needed. Prepare the window using the devkit live guide; do not kill or restart a working endpoint.
2. Set the environment above, then run `npm run smoke:native`. Alternatively, pass the equivalent flags after `--`.
3. Inspect the report and cleanup result. Missing configuration exits before app interaction.

Options:

- `--list`: list scenario IDs; no configuration required.
- `--scenario=<id[,id]>`: run selected scenarios.
- `--demo-failure --demo-blocked`: add demonstrations that must report Failed and Blocked respectively, then clean up.

### Scenarios

| ID | Observable result |
| --- | --- |
| `s1-icon-drafts` | Add/Edit icon controls and drafts survive mode switches; cancellation discards changes |
| `s2-sibling-price-draft` | Saving one card preserves another editor's draft and focus; click-away commits once |
| `s3-currency-save-focus` | Pending save locks fields/buttons and ignores typing; save persists once, closes, and reopens editable |
| `s4-reload-persistence` | CLI resolves the exact vault; reload preserves data/settings without duplicate registration |
| `s5-date-refresh` | A reversible Date-only shim triggers countdown refresh without a save; timers keep running |
| `s6-summary-geometry` | At actual sidebar widths of 600/320px, scrolling shows/hides the floating total; text clears the status bar, reserved space matches panel height, and the view fits the window |

S3 establishes draft/selection before saving; it checks fresh initial focus after reopening, not focus continuity through a disabled or closed modal. S6 widths are controlled layout setup, restored afterwards.

Exit codes: **0** all Passed with complete cleanup; **1** at least one Failed; **2** Blocked or incomplete cleanup without failures; **3** configuration/harness error.

### Cleanup and recovery

Native tests create only identified `SMOKE` fixtures through the UI. They record settings before changes and restore fixtures, settings, sidebar width, Date and runtime instrumentation. Headless probes do not touch vault data.

After interruption:

1. Read the run report and remove only its identified fixtures through the UI.
2. Restore the original settings (`Confirm before delete`, `Total position`, `Show disabled`) and sidebar width.
3. Restore runtime wrappers on their original instances; never copy an old bound method onto a reloaded plugin.
4. Restore a remaining Date shim with `restoreRealDate` from `lib/inject.mjs`; plugin reload alone does not clear it. If recovery is unsafe, gracefully restart the test app after resolving pending prompts, then verify persisted data separately.

Never reset the vault, bulk-delete data or restore a backup as routine cleanup.

### Host notes and manual checks

- Settings navigation uses `app.setting.open/close` as setup. A temporary marker on the verified vault's `app.setting.popout.win` proves popout ownership and is then removed. Tested controls use real input.
- The save gate holds completion after the underlying write, not the disk write itself.
- Enter/arrow keydown delivery to number inputs was unreliable in the tested CDP environment. Native scenarios use blur; Enter remains covered by unit tests.
- Still manual: desktop composition, third-party themes, editor-popout variants and mobile.
- Desktop-only tooling causes documented Node API lint warnings. Electron probes and test instrumentation stay outside the production bundle.
