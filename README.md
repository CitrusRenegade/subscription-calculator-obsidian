# Subscription Calculator

Subscription Calculator is an Obsidian plugin for tracking recurring subscriptions directly inside your vault.

It helps you keep a compact list of active and paused subscriptions, see yearly totals, and understand what your subscriptions cost over time.

## Features

- Track subscriptions with name, price, currency, billing period, and icon.
- See totals per year and approximate totals per month.
- Keep totals separated by currency.
- Enable or disable subscriptions without deleting them.
- Exclude disabled subscriptions from totals.
- Add, edit, and delete subscriptions from a dedicated plugin view.
- Use cached favicons, manual icon URLs, emoji icons, or text fallback icons.

## Usage

Open the `Subscriptions` view from the ribbon icon or the command palette.

Use `Add subscription` to create a new item. Each subscription can have:

- a name;
- a price;
- a currency;
- a billing period;
- an optional service URL;
- an optional cancellation URL;
- an icon.

The toggle on each card controls whether the subscription is currently active. Disabled subscriptions stay in the list but are not counted in totals.

## Data And Privacy

Subscription Calculator stores its data locally using Obsidian's plugin storage.

It does not require:

- Dataview;
- Obsidian Bases;
- frontmatter;
- one note per subscription;
- an external account;
- an external service for normal viewing and editing.

Normal viewing and editing does not require internet access. Internet access is only used when fetching or refreshing favicons.

## Status

The plugin is in an early MVP stage. The core local subscription tracking workflow is available, and more features may be added over time.
