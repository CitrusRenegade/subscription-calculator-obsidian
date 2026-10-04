The suite separates domain behavior from DOM interaction. Production code and user data are never modified by the regression probes.

## Commands

- `npm test`: test TypeScript checks and all Vitest suites.
- `npm run check`: tests, production build and Obsidian lint rules.
- `npm run test:regressions`: first runs selected tests unchanged, then checks that ten deliberately broken variants fail. Temporary Vite transforms inject the variants; source files stay untouched. A runner error does not count as detecting a regression.
- `npx vitest run --sequence.shuffle --sequence.seed=42`: runs tests in shuffled order; run the regular typecheck first.

## Boundaries

Node suites cover money, dates, migrations, persistence, queued CLI reads and icon races. `helpers/deferred.ts` exposes explicit completion gates; `helpers/storeFixture.ts` builds the real store, registry and icon service. Tests release owned gates and settle pending work before disposing stores or resetting globals/timers. Teardown permits only cleanup saves to complete without opening another test gate; asserted operations still use the test's save callback.

UI suites opt into jsdom and share `helpers/obsidianDom.ts`. Nodes, events, disabled buttons, focus and number-input selection use native DOM semantics. The adapter only supplies the Obsidian UI API boundary. Store/view/card integration uses the actual components and checks that completing one save preserves another card's active draft.

The node-only `obsidianMock.ts` remains for plugin API tests. Registered cleanup is exercised, but the real Obsidian loader is outside that test.

jsdom does not measure layout, render themes, reproduce Obsidian settings rerenders or prove desktop/popout behavior. CSS text assertions likewise do not establish a visual result.

## Native smoke protocol

Use only the configured `test3` vault at `C:\test3`; preserve its subscriptions and settings. Build/reload first, open the plugin view and settings, and record the loaded artifact. Treat a hidden window or missing initial focus as blocked, never as a pass.

1. With Obsidian visible and focused, open a price editor, type a draft, and save another card. Check that the draft and active editor survive. Cancel or restore any test edits.
2. In Custom currencies, focus a text field and set a selection before triggering a settings refresh. Check initial focus first, then verify draft, selection and focus after refresh. Check both the primary window and a popout where supported.
3. Open Add/Edit dialogs and switch Custom/Emoji modes. Check conditional controls and retained drafts; close without saving.
4. Inspect narrow and wide views, summary overlap and bottom spacing with the actual theme. Native screenshots/layout checks are separate from the automated DOM suite.
