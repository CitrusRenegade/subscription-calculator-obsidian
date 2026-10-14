# Repository Map

```text
src/
├── main.ts                         Plugin entry point and lifecycle
├── types.ts                        Shared domain and data types
├── constants.ts                    Shared constants
├── cli/subscriptions.ts            Human CLI commands, JSON queries, discovery and summary
├── data/
│   ├── SubscriptionStore.ts        Subscription state and business logic
│   ├── subscriptionCommands.ts     Strict candidates shared by writes and previews
│   ├── backup.ts                   Restorable backup serialization and restore
│   ├── defaultData.ts              Default plugin data and settings
│   └── migrations.ts               Persisted data migrations
├── date/
│   ├── Clock.ts                    Injectable clock abstraction
│   ├── dateOnly.ts                 Local date-only helpers
│   └── paymentSchedule.ts          Next-payment calculations
├── icons/
│   ├── IconService.ts              Favicon cache and refresh logic
│   ├── currencyIcon.ts             Currency fallback icons
│   ├── faviconProviders.ts         Favicon provider URLs
│   └── url.ts                      URL normalization helpers
├── money/
│   ├── CurrencyRegistry.ts         Currency lookup registry
│   ├── currencies.ts               Built-in currencies
│   ├── formatMoney.ts              Money formatting
│   ├── parseMoneyInput.ts          Money input parsing
│   └── totals.ts                   Subscription total calculations
├── settings/
│   └── SubscriptionSettingTab.ts   Obsidian settings UI
└── ui/
    ├── AddSubscriptionModal.ts     Add-subscription dialog
    ├── ConfirmDeleteModal.ts       Delete confirmation dialog
    ├── EditSubscriptionModal.ts    Edit-subscription dialog
    ├── SubscriptionsView.ts        Main subscriptions view
    ├── subscriptionSort.ts         Subscription sorting
    └── components/
        ├── AddSubscriptionCard.ts
        ├── FormControls.ts
        ├── SubscriptionCard.ts
        ├── SubscriptionSummaryTable.ts
        └── SummaryHeader.ts

tests/                              Unit and integration tests across store, UI, lifecycle, migrations, icons, styling, and build support
```

## `src/data/SubscriptionStore.ts`

This is the main complexity hotspot. A subscription can be effectively disabled during
the 1.5-second grace period while its persisted `status` is still enabled. Use the
store's view/query methods instead of reading or mutating `PluginData.subscriptions`
from UI code.

## CLI

`src/cli/subscriptions.ts` owns command registration, argument mapping and output. Strict candidates belong in `src/data/subscriptionCommands.ts`; `SubscriptionStore` owns queued writes, rollback, status intents and dry-run. Local root `DECISIONS.md`, section CLI, records the purpose, rationale and durable interface choices.

Keep consequential code or architecture choices and their evidenced reasons in local root `DECISIONS.md`. Prefer durable intent and behavior over inventories of current flags, fields or error codes. Do not record work progress, file moves or check results there.

## `src/data/migrations.ts`

Saved plugin data is treated as untrusted input and rebuilt into a valid current shape.
Any persisted field change must also be reflected in `types.ts` and `defaultData.ts`.

## `src/date/paymentSchedule.ts`

Monthly and yearly recurrence uses the original start-date anchor. End-of-month
clamping must not turn into drift across later payments.

## `src/ui/components/SubscriptionCard.ts`

Responsive measurement uses `ResizeObserver` and animation frames. Keep DOM operations
compatible with Obsidian popout windows (`window.*` and cross-window-safe element
checks).

## `src/icons/IconService.ts`

The service updates both `PluginData.iconCache` and the subscription's `icon.cacheKey`.
Clearing or replacing an icon must keep those two sides consistent.

## `tests/`

Tests cover calculation, store and migration behavior, plugin lifecycle, settings, dialogs, cards, icons, styling, backup, and build support. Check the current `tests/*.test.ts` files for exact coverage; Obsidian visual behavior still needs a configured live test vault.
