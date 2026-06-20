# Repository Map

```text
src/
├── main.ts                         Plugin entry point and lifecycle
├── types.ts                        Shared domain and data types
├── constants.ts                    Shared constants
├── data/
│   ├── SubscriptionStore.ts        Subscription state and business logic
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

tests/
├── currencyIcon.test.ts            Currency icon selection
├── dateOnly.test.ts                Local date-only helpers
├── money.test.ts                   Money parsing, formatting, and totals
├── paymentSchedule.test.ts         Next-payment calculations
└── subscriptionSort.test.ts        Subscription sorting
```

## `src/data/SubscriptionStore.ts`

This is the main complexity hotspot. A subscription can be effectively disabled during
the four-second grace period while its persisted `status` is still enabled. Use the
store's view/query methods instead of reading or mutating `PluginData.subscriptions`
from UI code.

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

Tests currently cover pure calculation and sorting modules. Store timers, persistence,
migrations, and Obsidian UI behavior do not have dedicated tests.
