// Suite-owned fixtures driven through the real UI (locator clicks, selects, keyboard).
// Every created subscription/currency and every restored setting is recorded and undone
// in restore(); cleanup runs even after scenario failure. No store or handler calls.
//
// Page-side snippets are source strings: they run inside the Obsidian renderer.
// app.setting open/close and leaf detach are navigation/cleanup setup only, never a
// tested behavior.
import { setTimeout as sleep } from "node:timers/promises";
import { readVaultData, waitForVaultData } from "./probes.mjs";
import { ScenarioBlocked } from "./steps.mjs";

const MODAL_TIMEOUT = 6000;

const CLOSE_SETTINGS_SOURCE = `(() => {
    try { app.setting.close(); } catch (error) { /* settings may already be closed */ }
  })()
`;

const OPEN_SETTINGS_SOURCE = `(() => {
    app.setting.open();
  })()
`;

// Identity of a candidate settings popout: the popout page exposes no app global
// and no usable opener, so ownership is proven with a unique temporary marker
// property assigned through the main page's own app.setting.popout.win reference
// (the main page is validated to this exact vault and plugin by the connector).
// The candidate page that observes the marker IS that window; titles are never
// trusted and the marker is always cleared again.
const CLAIM_SETTINGS_MARKER_SOURCE = `(() => {
    const win = app.setting?.popout?.win;
    if (!win || win.closed) return { ok: false, error: 'no open settings popout' };
    const marker = 'subcalc-settings-owner-' + Math.random().toString(36).slice(2);
    try { win.__subcalcSettingsOwner = marker; } catch (error) { return { ok: false, error: String(error) }; }
    return { ok: true, marker };
  })()
`;

const READ_SETTINGS_MARKER_SOURCE = `(() => ({ marker: window.__subcalcSettingsOwner ?? null }))()
`;

const CLEAR_SETTINGS_MARKER_SOURCE = `(() => { delete window.__subcalcSettingsOwner; return true; })()
`;

const DETACH_VIEW_SOURCE = `(() => {
    const leaf = app.workspace.getLeavesOfType('subscription-calculator-view')[0];
    if (!leaf) return { ok: false, error: 'view leaf not found' };
    leaf.detach();
    return { ok: true };
  })()
`;

export class Fixtures {
  /** @type{Array<{name: string, id: string|null}>} */
  createdSubscriptions = [];
  /** @type{Array<{label: string, displayLabel: string, code: string|null}>} */
  createdCurrencies = [];
  /** @type{Array<{name: string, key: string, from: boolean, to: boolean}>} */
  settingChanges = [];
  viewWasOpen = null;

  constructor(page, config) {
    this.page = page;
    this.config = config;
  }

  // --- View ---

  async ensureViewOpen() {
    if (this.viewWasOpen === null) {
      this.viewWasOpen = await this.page
        .locator(".subscription-calculator-add-card")
        .isVisible({ timeout: 1500 })
        .catch(() => false);
    }
    if (!(await this.page.locator(".subscription-calculator-add-card").isVisible().catch(() => false))) {
      await this.page.locator('.clickable-icon[aria-label="Open subscriptions"]').click();
      await this.page.locator(".subscription-calculator-add-card").waitFor({ state: "visible", timeout: MODAL_TIMEOUT });
    }
  }

  cardLocator(name) {
    return this.page
      .locator(".subscription-calculator-card")
      .filter({ has: this.page.locator(".subscription-calculator-card-name", { hasText: name }) });
  }

  /**
   * Assert the modal's initial focus precondition. The focused element must be an
   * input inside THIS modal; unmet focus is Blocked, never a pass.
   */
  async expectInitialFocus(modal, expectedAria, context) {
    const focused = await modal.evaluate((element, expected) => {
      const active = element.ownerDocument.activeElement;
      return {
        inside: !!active && element.contains(active),
        tag: active?.tagName ?? null,
        aria: active?.getAttribute("aria-label") ?? null,
      };
    }, expectedAria);
    if (!(focused.inside && focused.tag === "INPUT" && focused.aria === expectedAria)) {
      throw new ScenarioBlocked(
        `${context} did not establish initial focus on "${expectedAria}" (focus: ${focused.tag}/${focused.aria ?? "none"}, inside modal: ${focused.inside})`
      );
    }
  }

  // --- Subscriptions ---

  /** Create a subscription through the Add dialog. */
  async addSubscription({ name, price, currency = "USD", period = "monthly", startDate = null }) {
    await this.ensureViewOpen();
    await this.page.locator(".subscription-calculator-add-card").click();
    const modal = this.page.locator(".modal .subscription-calculator-modal");
    await modal.waitFor({ state: "visible", timeout: MODAL_TIMEOUT });
    await this.expectInitialFocus(modal, "Name", "Add dialog");
    await modal.locator('input[aria-label="Name"]').fill(name);
    await modal.locator('input[aria-label="Price"]').fill(price);
    await modal.locator('select[aria-label="Currency"]').selectOption(currency);
    await modal.locator('select[aria-label="Billing period"]').selectOption(period);
    if (startDate) await modal.locator('input[aria-label="Start date"]').fill(startDate);
    // Register the fixture intent before the save so a successful write with a later
    // failed wait can never orphan the fixture; the id is reconciled afterwards.
    const registered = { name, id: null };
    this.createdSubscriptions.push(registered);
    await modal.getByRole("button", { name: "Add", exact: true }).click();
    await modal.waitFor({ state: "hidden", timeout: MODAL_TIMEOUT });
    const saved = await waitForVaultData(
      this.config,
      (data) => data.subscriptions.some((item) => item.name === name),
      8000,
      `saved subscription "${name}"`
    );
    registered.id = saved.data.subscriptions.find((item) => item.name === name)?.id ?? null;
    return { id: registered.id, name };
  }

  /**
   * Delete a subscription by name through the card's delete control, handling both
   * the confirmed and the unconfirmed path. Returns false only when the fixture is
   * truly absent from the UI and the persisted data.
   */
  async deleteSubscription(name) {
    await this.ensureViewOpen();
    let card = this.cardLocator(name);
    if (!(await card.isVisible().catch(() => false))) {
      const persisted = await readVaultData(this.config);
      if (!persisted.data.subscriptions.some((item) => item.name === name)) return false;
      // Visible-in-data but not in the view: give the view one render to catch up.
      await sleep(500);
      card = this.cardLocator(name);
      if (!(await card.isVisible().catch(() => false))) {
        throw new Error(`subscription "${name}" exists in data but has no card in the view`);
      }
    }
    await card.locator('[aria-label="Delete subscription"]').click();
    const confirm = this.page.locator(".modal").filter({ hasText: "Delete subscription?" });
    if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) {
      await confirm
        .locator(".subscription-calculator-discard-actions")
        .getByRole("button", { name: "Delete", exact: true })
        .click();
    }
    await card.waitFor({ state: "hidden", timeout: MODAL_TIMEOUT });
    await waitForVaultData(
      this.config,
      (data) => !data.subscriptions.some((item) => item.name === name),
      8000,
      `removal of "${name}"`
    );
    this.createdSubscriptions = this.createdSubscriptions.filter((item) => item.name !== name);
    return true;
  }

  // --- Settings (the settings window is a separate popout page in this build) ---

  /** Find THIS vault's own settings popout, validated by marker identity. */
  async findOwnedSettingsPopout() {
    const claim = await this.page
      .evaluate(CLAIM_SETTINGS_MARKER_SOURCE)
      .catch((error) => ({ ok: false, error: String(error) }));
    if (!claim.ok) return null; // the main page has no open settings popout right now
    let found = null;
    for (const candidate of this.page.context().pages()) {
      if (candidate === this.page || candidate.isClosed()) continue;
      const read = await candidate.evaluate(READ_SETTINGS_MARKER_SOURCE).catch(() => null);
      if (read?.marker === claim.marker) {
        found = candidate;
        break;
      }
    }
    // The marker is temporary: clear it through the main reference and, when a
    // page was found, on the popout itself (it may close between claim and clear).
    await this.page
      .evaluate(`(() => { try { delete app.setting.popout.win.__subcalcSettingsOwner; } catch (error) { /* already gone */ } })()`)
      .catch(() => {});
    if (found) await found.evaluate(CLEAR_SETTINGS_MARKER_SOURCE).catch(() => {});
    return found;
  }

  async openSettings() {
    // Known state first, but only for THIS vault's own settings window: the settings
    // command toggles an already-open window, and unrelated popouts are left alone.
    const existing = await this.findOwnedSettingsPopout();
    if (existing) {
      await this.page.evaluate(CLOSE_SETTINGS_SOURCE);
      for (let i = 0; i < 16 && !existing.isClosed(); i++) await sleep(250);
    }
    // Obsidian routes palette entries and commands through its active-window
    // tracking, which does not reliably target a background test window, so the
    // documented settings API is the navigation setup here (see tests/README.md).
    await this.page.evaluate(OPEN_SETTINGS_SOURCE);
    for (let i = 0; i < 24; i++) {
      const popout = await this.findOwnedSettingsPopout();
      if (popout && (await popout.locator(".vertical-tab-nav-item").first().isVisible({ timeout: 300 }).catch(() => false))) {
        this.settingsPage = popout;
        popout.setDefaultTimeout(MODAL_TIMEOUT);
        return popout;
      }
      await sleep(250);
    }
    throw new ScenarioBlocked("this vault's settings window did not open");
  }

  async closeSettings() {
    // The popout's header close button is hover-gated; the documented API closes it.
    await this.page.evaluate(CLOSE_SETTINGS_SOURCE);
    const popout = this.settingsPage;
    this.settingsPage = undefined;
    if (!popout) return;
    for (let i = 0; i < 16 && !popout.isClosed(); i++) await sleep(250);
  }

  async openPluginTab(settingsPage) {
    // A nested settings subpage replaces the vertical nav; back out of it first.
    if (!(await settingsPage.locator(".vertical-tab-nav-item").first().isVisible({ timeout: 800 }).catch(() => false))) {
      const back = settingsPage.locator(".setting-page-back-button, .modal-setting-back-button").first();
      await back.click({ timeout: MODAL_TIMEOUT });
    }
    await settingsPage.locator(".vertical-tab-nav-item", { hasText: "Subscription Calculator" }).click();
    await this.namedSettingRow(settingsPage, "Custom currencies").waitFor({ state: "visible", timeout: MODAL_TIMEOUT });
  }

  currencyRow(settingsPage, displayLabel) {
    return settingsPage
      .locator(".setting-item.mod-action")
      .filter({ has: settingsPage.locator(".setting-item-name", { hasText: displayLabel }) });
  }

  /** Setting rows matched by their exact name element, never by description text. */
  namedSettingRow(settingsPage, name) {
    return settingsPage
      .locator(".setting-item")
      .filter({ has: settingsPage.locator(".setting-item-name", { hasText: new RegExp(`^${name}$`) }) })
      .first();
  }

  async openCustomCurrenciesPage(settingsPage) {
    await this.openPluginTab(settingsPage);
    await this.namedSettingRow(settingsPage, "Custom currencies").click();
    await settingsPage.locator('[aria-label="Add currency"]').waitFor({ state: "visible", timeout: MODAL_TIMEOUT });
  }

  /** Add a custom currency through the real settings UI (ungated fixture flavor). */
  async addCustomCurrency({ label, marker = "" }) {
    const settingsPage = await this.openSettings();
    await this.openCustomCurrenciesPage(settingsPage);
    await settingsPage.locator('[aria-label="Add currency"]').click();
    const modal = settingsPage.locator(".modal .subscription-calculator-modal");
    await modal.waitFor({ state: "visible", timeout: MODAL_TIMEOUT });
    await this.expectInitialFocus(modal, "Currency label", "Add-currency dialog");
    await modal.locator('input[aria-label="Currency label"]').fill(label);
    if (marker) await modal.locator('input[aria-label="Symbol"]').fill(marker);
    const displayLabel = marker ? `${label} ${marker}` : label;
    // Intent registered before the save; id reconciled after the persisted write.
    const registered = { label, displayLabel, code: null };
    this.createdCurrencies.push(registered);
    await modal
      .locator(".subscription-calculator-modal-actions")
      .getByRole("button", { name: "Add currency", exact: true })
      .click();
    await modal.waitFor({ state: "hidden", timeout: MODAL_TIMEOUT });
    const saved = await waitForVaultData(
      this.config,
      (data) => data.customCurrencies.some((currency) => currency.label === label),
      8000,
      `saved custom currency "${label}"`
    );
    registered.code = saved.data.customCurrencies.find((currency) => currency.label === label)?.code ?? null;
    return registered;
  }

  /** Delete a custom currency by label through the settings UI and its confirmation. */
  async deleteCustomCurrency(label, displayLabel) {
    // A registered intent may never have persisted (the scenario can be blocked
    // before its save); reconcile persisted absence before opening any window.
    const persisted = await readVaultData(this.config);
    if (!persisted.data.customCurrencies.some((currency) => currency.label === label)) {
      this.createdCurrencies = this.createdCurrencies.filter((item) => item.label !== label);
      return false;
    }
    const settingsPage = this.settingsPage ?? (await this.openSettings());
    await this.openCustomCurrenciesPage(settingsPage);
    const row = this.currencyRow(settingsPage, displayLabel ?? label);
    if (!(await row.first().isVisible().catch(() => false))) {
      throw new Error(`custom currency "${label}" exists in data but has no row on the settings page`);
    }
    await row.first().click();
    const modal = settingsPage.locator(".modal .subscription-calculator-modal");
    await modal.waitFor({ state: "visible", timeout: MODAL_TIMEOUT });
    await modal
      .locator(".subscription-calculator-modal-actions")
      .getByRole("button", { name: /^Delete currency$|^Archive currency$/ })
      .click();
    const confirm = settingsPage.locator(".modal .subscription-calculator-discard-actions");
    await confirm.waitFor({ state: "visible", timeout: MODAL_TIMEOUT });
    await confirm.getByRole("button", { name: /^Delete currency$|^Archive currency$/ }).click();
    await modal.waitFor({ state: "hidden", timeout: MODAL_TIMEOUT });
    await waitForVaultData(
      this.config,
      (data) => !data.customCurrencies.some((currency) => currency.label === label),
      8000,
      `removal of custom currency "${label}"`
    );
    this.createdCurrencies = this.createdCurrencies.filter((item) => item.label !== label);
    return true;
  }

  /**
   * Flip a plugin-settings toggle by its exact row name and wait for the persisted
   * value. The current value comes from persisted data: Obsidian mirrors toggle
   * state on the container's is-enabled class and does not sync input.checked in
   * this build, so isChecked() misreads every toggle. The click goes through the
   * visible container (the real user surface), and the persisted value is always
   * verified afterwards, whether or not a click was needed.
   */
  async setToggleSetting(name, key, value, { record = true } = {}) {
    const settingsPage = this.settingsPage ?? (await this.openSettings());
    await this.openPluginTab(settingsPage);
    const row = this.namedSettingRow(settingsPage, name);
    const current = (await readVaultData(this.config)).data.settings[key];
    if (current !== value) {
      // Intent registered before the attempted mutation so cleanup restores the
      // original even when the disk wait times out after a transient failure.
      if (record) this.settingChanges.push({ name, key, from: current, to: value });
      await row.locator(".checkbox-container").click();
      await waitForVaultData(this.config, (data) => data.settings[key] === value, 8000, `${key}=${value}`);
    }
    const after = await readVaultData(this.config);
    if (after.data.settings[key] !== value) {
      throw new Error(`setting ${key} is ${after.data.settings[key]} after the toggle interaction, expected ${value}`);
    }
    return current;
  }

  /**
   * Undo everything this suite created or changed. Best-effort per item: problems
   * are collected, never thrown past the caller, and reported in the run summary.
   */
  async restore() {
    const problems = [];
    for (const change of [...this.settingChanges].reverse()) {
      try {
        if (change.restoreVia === "view-toolbar") {
          const button = this.page.locator('.subscription-calculator-toolbar button[data-focus-key="show-disabled"]');
          const current = (await readVaultData(this.config)).data.settings[change.key];
          if (current !== change.from) {
            await this.ensureViewOpen();
            await button.click();
            const deadline = Date.now() + 8000;
            let state = await readVaultData(this.config);
            while (state.data.settings[change.key] !== change.from && Date.now() < deadline) {
              await sleep(150);
              state = await readVaultData(this.config);
            }
            if (state.data.settings[change.key] !== change.from) {
              throw new Error(`view toolbar did not restore ${change.key} to ${change.from}`);
            }
          }
        } else {
          await this.setToggleSetting(change.name, change.key, change.from, { record: false });
        }
        this.settingChanges = this.settingChanges.filter((item) => item !== change);
      } catch (error) {
        problems.push(`setting ${change.name} back to ${change.from}: ${error.message}`);
      }
    }
    for (const currency of [...this.createdCurrencies]) {
      try {
        await this.deleteCustomCurrency(currency.label, currency.displayLabel);
      } catch (error) {
        problems.push(`delete custom currency ${currency.label}: ${error.message}`);
      }
    }
    for (const subscription of [...this.createdSubscriptions]) {
      try {
        await this.deleteSubscription(subscription.name);
      } catch (error) {
        problems.push(`delete subscription ${subscription.name}: ${error.message}`);
      }
    }
    if (this.settingsPage && !this.settingsPage.isClosed()) {
      try {
        await this.closeSettings();
      } catch (error) {
        problems.push(`close settings window: ${error.message}`);
      }
    }
    // If this run opened the subscriptions view, undo that layout change as well.
    if (this.viewWasOpen === false) {
      try {
        const state = await this.page.evaluate(DETACH_VIEW_SOURCE).catch((error) => ({ ok: false, error: String(error) }));
        if (!state.ok) problems.push(`close subscriptions view opened by the run: ${state.error}`);
      } catch (error) {
        problems.push(`close subscriptions view opened by the run: ${error.message}`);
      }
    }
    return { complete: problems.length === 0, problems };
  }
}
