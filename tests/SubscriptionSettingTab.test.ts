import { describe, expect, it, vi } from "vitest";

vi.stubGlobal(
  "createFragment",
  () => ({ append: () => undefined }) as unknown as DocumentFragment
);

vi.mock("obsidian", () => {
  class App {}

  class MockDocument {
    readonly createdElements: MockElement[] = [];
    activeElement: MockElement | null = null;
    readonly defaultView = { confirm: () => true };

    createElement(tagName: string): MockElement {
      const element = new MockElement(this, tagName);
      this.createdElements.push(element);
      return element;
    }
  }

  class MockElement {
    readonly children: MockElement[] = [];
    type = "";
    accept = "";
    files: FileList | null = null;
    wasClicked = false;
    parent: MockElement | undefined;
    value = "";
    selectionStart: number | null = null;
    selectionEnd: number | null = null;
    readonly attributes = new Map<string, string>();
    readonly tagName: string;

    constructor(
      readonly ownerDocument: MockDocument,
      tagName = "div"
    ) { this.tagName = tagName.toUpperCase(); }

    createEl(tagName: string): MockElement {
      const child = this.ownerDocument.createElement(tagName);
      child.parent = this;
      this.children.push(child);
      return child;
    }

    createDiv(): MockElement {
      const child = this.ownerDocument.createElement("div");
      child.parent = this;
      this.children.push(child);
      return child;
    }

    createSpan(): MockElement {
      const child = this.ownerDocument.createElement("span");
      child.parent = this;
      this.children.push(child);
      return child;
    }

    addClass(_className: string): void {}
    setAttribute(key: string, value: string): void { this.attributes.set(key, value); }
    getAttribute(key: string): string | null { return this.attributes.get(key) ?? null; }
    closest(selector: string): MockElement | null {
      return this.attributes.has(selector.slice(1, -1)) ? this : this.parent?.closest(selector) ?? null;
    }
    querySelectorAll(selector: string): MockElement[] {
      const matches = (element: MockElement) => selector.startsWith("[")
        ? element.attributes.has(selector.slice(1, -1))
        : selector.split(",").some((tag) => tag.trim().toUpperCase() === element.tagName);
      return this.children.flatMap((child) => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    contains(element: MockElement | null): boolean { return this === element || this.children.some((child) => child.contains(element)); }
    focus(): void { this.ownerDocument.activeElement = this; }
    setSelectionRange(start: number, end: number): void { this.selectionStart = start; this.selectionEnd = end; }

    empty(): void {
      if (this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = null;
      this.children.length = 0;
    }

    remove(): void {
      if (!this.parent) return;
      const index = this.parent.children.indexOf(this);
      if (index !== -1) this.parent.children.splice(index, 1);
      this.parent = undefined;
    }

    addEventListener(_event: string, _callback: () => void): void {}

    click(): void {
      this.wasClicked = true;
    }
  }

  class MockButton {
    readonly buttonEl = { addClass: (_className: string) => undefined };
    buttonText = "";
    disabled = false;
    private onClickCallback: (() => void | Promise<void>) | undefined;

    setButtonText(value: string): this {
      this.buttonText = value;
      return this;
    }

    setCta(): this {
      return this;
    }

    setDisabled(disabled: boolean): this {
      this.disabled = disabled;
      return this;
    }

    onClick(callback: () => void | Promise<void>): this {
      this.onClickCallback = callback;
      return this;
    }

    async click(): Promise<void> {
      await this.onClickCallback?.();
    }
  }

  class MockText {
    value = "";
    private onChangeCallback: ((value: string) => void) | undefined;
    constructor(readonly inputEl: MockElement) {}
    setPlaceholder(_value: string): this {
      return this;
    }

    setValue(value: string): this {
      this.value = value;
      this.inputEl.value = value;
      return this;
    }

    onChange(callback: (value: string) => void): this {
      this.onChangeCallback = callback;
      return this;
    }

    change(value: string): void {
      this.value = value;
      this.inputEl.value = value;
      this.onChangeCallback?.(value);
    }
  }

  class MockToggle {
    private onChangeCallback: ((value: boolean) => void | Promise<void>) | undefined;

    setValue(_value: boolean): this {
      return this;
    }

    setDisabled(_disabled: boolean): this {
      return this;
    }

    onChange(callback: (value: boolean) => void | Promise<void>): this {
      this.onChangeCallback = callback;
      return this;
    }

    async change(value: boolean): Promise<void> {
      await this.onChangeCallback?.(value);
    }
  }

  class MockDropdown {
    private onChangeCallback: ((value: string) => void | Promise<void>) | undefined;

    addOption(_value: string, _label: string): this {
      return this;
    }

    setValue(_value: string): this {
      return this;
    }

    onChange(callback: (value: string) => void | Promise<void>): this {
      this.onChangeCallback = callback;
      return this;
    }

    async change(value: string): Promise<void> {
      await this.onChangeCallback?.(value);
    }
  }

  class Setting {
    static readonly instances: Setting[] = [];
    readonly buttons: MockButton[] = [];
    readonly dropdowns: MockDropdown[] = [];
    readonly toggles: MockToggle[] = [];
    readonly texts: MockText[] = [];
    name = "";

    constructor(private readonly containerEl: MockElement) {
      Setting.instances.push(this);
    }

    static reset(): void {
      Setting.instances.length = 0;
    }

    setName(value: string): this {
      this.name = value;
      return this;
    }

    setHeading(): this {
      return this;
    }

    setDesc(_value: unknown): this {
      return this;
    }

    addText(callback: (text: MockText) => void): this {
      const text = new MockText(this.containerEl.createEl("input"));
      this.texts.push(text);
      callback(text);
      return this;
    }

    addToggle(callback: (toggle: MockToggle) => void): this {
      const toggle = new MockToggle();
      this.toggles.push(toggle);
      callback(toggle);
      return this;
    }

    addDropdown(callback: (dropdown: MockDropdown) => void): this {
      const dropdown = new MockDropdown();
      this.dropdowns.push(dropdown);
      callback(dropdown);
      return this;
    }

    addButton(callback: (button: MockButton) => void): this {
      const button = new MockButton();
      this.buttons.push(button);
      callback(button);
      return this;
    }
  }

  class PluginSettingTab {
    readonly containerEl = new MockElement(new MockDocument());
    updateCalls = 0;

    constructor(
      readonly app: App,
      readonly plugin: unknown
    ) {}

    getSettingDefinitions(): unknown[] {
      return [];
    }

    update(): void {
      this.updateCalls += 1;
    }
  }

  class SettingPage {
    readonly containerEl = new MockElement(new MockDocument());
    title = "";

    display(): void {}
  }

  return {
    App,
    MockDocument,
    MockElement,
    Notice: class Notice {
      static readonly messages: string[] = [];

      constructor(message: string) {
        Notice.messages.push(message);
      }

      static reset(): void {
        Notice.messages.length = 0;
      }
    },
    PluginSettingTab,
    Setting,
    SettingPage,
  };
});

type MockElementLike = {
  children: MockElementLike[];
  ownerDocument: MockDocumentLike;
  tagName: string;
  wasClicked: boolean;
};

type MockDocumentLike = {
  createdElements: MockElementLike[];
};

const mockedObsidian = (await import("obsidian")) as unknown as {
  Notice: { messages: string[]; reset(): void };
  Setting: unknown;
};
const { Notice, Setting } = mockedObsidian;
const { SubscriptionSettingTab } = await import(
  "../src/settings/SubscriptionSettingTab"
);

function createPlugin() {
  const data = {
    settings: {
      openMode: "right-sidebar",
      defaultCurrency: "USD",
      faviconProvider: "google-s2",
      confirmBeforeDelete: true,
      moneyDisplayPrecision: 0,
      floatingYearlyTotal: false,
    },
    customCurrencies: [] as Array<{
      amountMarker?: string;
      code: string;
      isArchived?: boolean;
      label: string;
      scale: number;
      source: "custom";
    }>,
  };
  return {
    data,
    currencyRegistry: {
      listSelectable: () => [
        { code: "USD", label: "USD", amountMarker: "$", scale: 2, source: "builtin" },
      ],
      getDefault: () => ({
        code: "USD",
        label: "USD",
        amountMarker: "$",
        scale: 2,
        source: "builtin",
      }),
    },
    store: {
      addCustomCurrency: vi.fn(),
      deleteCustomCurrency: vi.fn(),
      isCurrencyUsed: () => false,
      refreshAllIcons: vi.fn(),
      updateSettings: vi.fn(async (mutation: (settings: typeof data.settings) => void) => {
        mutation(data.settings);
      }),
      updateCustomCurrency: vi.fn(),
    },
    savePluginData: vi.fn(),
  };
}

type SettingDefinition = {
  control?: { key?: string; type?: string };
  heading?: string;
  items?: SettingDefinition[];
  name?: string;
  page?: () => { display(): void; title: string };
  render?: (setting: { addButton: unknown }, group: unknown) => void;
  type?: string;
};

function findDefinition(
  definitions: SettingDefinition[],
  name: string
): SettingDefinition | undefined {
  for (const definition of definitions) {
    if (definition.name === name) return definition;
    const child = definition.items && findDefinition(definition.items, name);
    if (child) return child;
  }
  return undefined;
}

describe("SubscriptionSettingTab", () => {
  it("restores the neighboring field after the native parent update takes focus", async () => {
    const plugin = createPlugin();
    plugin.data.customCurrencies.push(
      { code: "TOK", label: "TOK", scale: 2, source: "custom" },
      { code: "PTS", label: "PTS", scale: 0, source: "custom" }
    );
    const tab = new SubscriptionSettingTab({} as never, plugin as never);
    const page = findDefinition(tab.getSettingDefinitions() as SettingDefinition[], "Custom currencies")!.page!() as unknown as {
      display(): void;
      containerEl: { ownerDocument: { activeElement: unknown }; querySelectorAll(selector: string): Array<{ getAttribute(key: string): string | null; querySelectorAll(selector: string): Array<{ focus(): void; selectionStart: number | null; selectionEnd: number | null; setSelectionRange(start: number, end: number): void }> }> };
    };
    const settings = Setting as { instances: Array<{ buttons: Array<{ buttonText: string; click(): Promise<void> }> }>; reset(): void };
    settings.reset();
    page.display();
    const getField = () => page.containerEl.querySelectorAll("[data-currency-code]").find((row) => row.getAttribute("data-currency-code") === "PTS")!.querySelectorAll("input")[0];
    const field = getField();
    field.focus();
    field.setSelectionRange(1, 2);
    vi.spyOn(tab, "update").mockImplementation(() => { page.containerEl.ownerDocument.activeElement = null; });
    await settings.instances.flatMap((setting) => setting.buttons).find((button) => button.buttonText === "Save")!.click();
    expect(page.containerEl.ownerDocument.activeElement).toBe(getField());
    expect(getField().selectionStart).toBe(1);
    expect(getField().selectionEnd).toBe(2);
  });
  it("keeps another currency's draft when a neighboring currency saves", async () => {
    const plugin = createPlugin();
    plugin.data.customCurrencies.push(
      { code: "TOK", label: "TOK", scale: 2, source: "custom" },
      { code: "PTS", label: "PTS", scale: 0, source: "custom" }
    );
    const tab = new SubscriptionSettingTab({} as never, plugin as never);
    const page = findDefinition(tab.getSettingDefinitions() as SettingDefinition[], "Custom currencies")!.page!();
    const settings = Setting as { instances: Array<{ name: string; texts: Array<{ value: string; change(value: string): void }>; buttons: Array<{ buttonText: string; click(): Promise<void> }> }>; reset(): void };
    settings.reset();
    page.display();
    const labels = settings.instances.filter((setting) => setting.name === "Currency label");
    labels[2].texts[0].change("Draft");
    const save = settings.instances.flatMap((setting) => setting.buttons).find((button) => button.buttonText === "Save")!;
    await save.click();
    expect(settings.instances.filter((setting) => setting.name === "Currency label").at(-1)!.texts[0].value).toBe("Draft");
    const saves = settings.instances.flatMap((setting) => setting.buttons).filter((button) => button.buttonText === "Save");
    await saves.at(-1)!.click();
    expect(plugin.store.updateCustomCurrency).toHaveBeenLastCalledWith("PTS", expect.objectContaining({ label: "Draft" }));
  });
  it("publishes native settings controls and a Custom currencies page", () => {
    const tab = new SubscriptionSettingTab({} as never, createPlugin() as never);
    const definitions = (
      tab as unknown as { getSettingDefinitions(): SettingDefinition[] }
    ).getSettingDefinitions();

    expect(findDefinition(definitions, "Open subscriptions in")?.control).toMatchObject({
      key: "openMode",
      type: "dropdown",
    });
    expect(findDefinition(definitions, "Default currency")?.control).toMatchObject({
      key: "defaultCurrency",
      type: "dropdown",
      options: { USD: "USD $" },
    });
    expect(findDefinition(definitions, "Custom currencies")?.type).toBe("page");
    expect(
      definitions.find((definition) => definition.heading === "Backup and restore")?.type
    ).toBe("group");
  });

  it("reads and writes every declarative control through the subscription store", async () => {
    const plugin = createPlugin();
    const tab = new SubscriptionSettingTab({} as never, plugin as never) as unknown as {
      getControlValue?: (key: string) => unknown;
      setControlValue?: (key: string, value: unknown) => Promise<void>;
    };

    expect(tab.getControlValue).toBeTypeOf("function");
    expect(tab.setControlValue).toBeTypeOf("function");
    if (!tab.getControlValue || !tab.setControlValue) return;

    const cases = [
      ["openMode", "main-tab", "main-tab"],
      ["defaultCurrency", "EUR", "EUR"],
      ["moneyDisplayPrecision", true, true],
      ["floatingYearlyTotal", true, true],
      ["faviconProvider", "none", "none"],
      ["confirmBeforeDelete", false, false],
    ] as const;

    for (const [key, value, expectedControlValue] of cases) {
      await tab.setControlValue(key, value);
      expect(tab.getControlValue(key)).toBe(expectedControlValue);
    }

    expect(plugin.data.settings).toMatchObject({
      openMode: "main-tab",
      defaultCurrency: "EUR",
      moneyDisplayPrecision: 1,
      floatingYearlyTotal: true,
      faviconProvider: "none",
      confirmBeforeDelete: false,
    });
    expect(plugin.store.updateSettings).toHaveBeenCalledTimes(cases.length);
    expect((tab as unknown as { updateCalls: number }).updateCalls).toBe(cases.length);
  });

  it("refreshes the settings UI and preserves the saved value when a control save fails", async () => {
    Notice.reset();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const plugin = createPlugin();
    plugin.store.updateSettings.mockRejectedValueOnce(new Error("disk full"));
    const tab = new SubscriptionSettingTab({} as never, plugin as never) as unknown as {
      setControlValue(key: string, value: unknown): Promise<void>;
      updateCalls: number;
    };

    try {
      await expect(tab.setControlValue("defaultCurrency", "EUR")).resolves.toBeUndefined();

      expect(plugin.data.settings.defaultCurrency).toBe("USD");
      expect(Notice.messages).toEqual(["Failed to save setting"]);
      expect(tab.updateCalls).toBe(1);
      expect(error).toHaveBeenCalledWith("Failed to save setting:", expect.any(Error));
    } finally {
      error.mockRestore();
    }
  });

  it("disables Refresh all when favicon fetching is disabled and restores it after refreshing", async () => {
    const plugin = createPlugin();
    plugin.store.refreshAllIcons.mockResolvedValue({ refreshed: 1, failed: 0, skipped: 0 });
    const tab = new SubscriptionSettingTab({} as never, plugin as never);
    const definitions = (
      tab as unknown as { getSettingDefinitions(): SettingDefinition[] }
    ).getSettingDefinitions();
    const refreshAll = findDefinition(definitions, "Refresh all icons");
    expect(refreshAll?.render).toBeTypeOf("function");
    if (!refreshAll?.render) return;

    const settings = Setting as {
      instances: Array<{
        buttons: Array<{ buttonText: string; click(): Promise<void>; disabled: boolean }>;
      }>;
      reset(): void;
    };
    settings.reset();
    refreshAll.render(new (Setting as new (containerEl: unknown) => { addButton: unknown })(
      (tab as unknown as { containerEl: unknown }).containerEl
    ), {});
    const button = settings.instances.flatMap((setting) => setting.buttons)[0];
    expect(button?.disabled).toBe(false);

    await button?.click();
    expect(plugin.store.refreshAllIcons).toHaveBeenCalledOnce();
    expect(button?.buttonText).toBe("Refresh all");
    expect(button?.disabled).toBe(false);

    plugin.data.settings.faviconProvider = "none";
    settings.reset();
    refreshAll.render(new (Setting as new (containerEl: unknown) => { addButton: unknown })(
      (tab as unknown as { containerEl: unknown }).containerEl
    ), {});
    expect(settings.instances.flatMap((setting) => setting.buttons)[0]?.disabled).toBe(true);
  });

  it("keeps custom currency forms inside their settings page", async () => {
    const plugin = createPlugin();
    plugin.data.customCurrencies.push({
      amountMarker: "¤",
      code: "TOK",
      label: "TOK",
      scale: 2,
      source: "custom",
    });

    const tab = new SubscriptionSettingTab({} as never, plugin as never);
    const definitions = (
      tab as unknown as { getSettingDefinitions(): SettingDefinition[] }
    ).getSettingDefinitions();
    const customCurrencies = findDefinition(definitions, "Custom currencies");
    expect(customCurrencies?.type).toBe("page");
    if (!customCurrencies?.page) return;

    const page = customCurrencies.page();
    expect(page.title).toBe("Custom currencies");
    const settings = Setting as {
      instances: Array<{
        buttons: Array<{ buttonText: string; click(): Promise<void> }>;
      }>;
      reset(): void;
    };
    settings.reset();
    page.display();

    const button = (label: string) =>
      settings.instances
        .flatMap((setting) => setting.buttons)
        .find((candidate) => candidate.buttonText === label);

    await button("Add currency")?.click();
    expect(plugin.store.addCustomCurrency).toHaveBeenCalledWith({
      amountMarker: "",
      label: "",
      scale: 2,
    });

    await button("Save")?.click();
    expect(plugin.store.updateCustomCurrency).toHaveBeenCalledWith("TOK", {
      amountMarker: "¤",
      label: "TOK",
      scale: 2,
    });

    await button("Delete")?.click();
    expect(plugin.store.deleteCustomCurrency).toHaveBeenCalledWith("TOK");
  });

  it("waits for async export before downloading JSON and reports export failures", async () => {
    let resolveExport: ((value: string) => void) | undefined;
    const plugin = { ...createPlugin(), exportBackupJson: vi.fn(() => new Promise<string>((resolve) => { resolveExport = resolve; })) };
    const tab = new SubscriptionSettingTab({} as never, plugin as never);
    const container = (tab as unknown as { containerEl: MockElementLike }).containerEl;
    const document = container.ownerDocument;
    const createObjectURL = vi.fn((_blob: Blob) => "blob:backup");
    Object.assign(document, { body: container, defaultView: {
      Blob, URL: { createObjectURL, revokeObjectURL: vi.fn() }, setTimeout: () => 0,
    } });
    const definitions = (tab as unknown as { getSettingDefinitions(): SettingDefinition[] }).getSettingDefinitions();
    const exportDefinition = findDefinition(definitions, "Export backup");
    expect(exportDefinition?.render).toBeTypeOf("function");
    const settings = Setting as { instances: Array<{ buttons: Array<{ click(): Promise<void> }> }>; reset(): void };
    settings.reset();
    const setting = new (Setting as new (container: MockElementLike) => { addButton: unknown })(container);
    exportDefinition?.render?.(setting, {});
    const button = settings.instances[0].buttons[0];
    const clicking = button.click();
    expect(createObjectURL).not.toHaveBeenCalled();
    resolveExport?.('{"format":"backup"}');
    await clicking;
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(await blob.text()).toBe('{"format":"backup"}');
    expect(document.createdElements.find((element) => element.tagName === "A")?.wasClicked).toBe(true);
    plugin.exportBackupJson.mockImplementation(() => Promise.reject(new Error("Read failed")));
    Notice.reset();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await button.click();
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(Notice.messages).toContain("Failed to download backup");
      expect(errorLog).toHaveBeenCalled();
    } finally { errorLog.mockRestore(); }
  });

  it("updates declarative settings after restoring a backup", async () => {
    const plugin = {
      ...createPlugin(),
      restoreBackupJson: vi.fn().mockResolvedValue({
        subscriptions: { imported: 1, skipped: 0 },
        customCurrencies: { imported: 0, skipped: 0 },
      }),
    };
    const settings = Setting as {
      instances: unknown[];
      reset(): void;
    };
    settings.reset();
    const tab = new SubscriptionSettingTab({} as never, plugin as never);
    type RestoreButton = {
      setDisabled(disabled: boolean): RestoreButton;
      setButtonText(text: string): RestoreButton;
    };
    const button: RestoreButton = {
      setDisabled: () => button,
      setButtonText: () => button,
    };

    await (
      tab as unknown as {
        restoreBackupFile(file: File, button: RestoreButton): Promise<void>;
      }
    ).restoreBackupFile({ text: async () => "{}" } as File, button);

    expect(plugin.restoreBackupJson).toHaveBeenCalledOnce();
    expect((tab as unknown as { updateCalls: number }).updateCalls).toBe(1);
  });

  it("opens Restore JSON's detached file input from its native setting row", () => {
    const tab = new SubscriptionSettingTab({} as never, createPlugin() as never);
    const container = (tab as unknown as { containerEl: MockElementLike }).containerEl;
    const document = container.ownerDocument;
    const definitions = (
      tab as unknown as { getSettingDefinitions(): SettingDefinition[] }
    ).getSettingDefinitions();
    const restoreBackup = findDefinition(definitions, "Restore backup");
    expect(restoreBackup?.render).toBeTypeOf("function");
    if (!restoreBackup?.render) return;

    const settings = Setting as {
      instances: Array<{
        name: string;
        buttons: Array<{ buttonText: string; click(): void }>;
      }>;
      reset(): void;
    };
    settings.reset();

    const setting = new (Setting as new (containerEl: MockElementLike) => {
      addButton: unknown;
      setName(value: string): unknown;
    })(container);
    setting.setName("Restore backup");
    restoreBackup.render(setting, {});

    const restoreButton = settings.instances
      .find((setting) => setting.name === "Restore backup")
      ?.buttons.find((button) => button.buttonText === "Restore JSON");
    restoreButton?.click();

    const fileInput = document.createdElements.find(
      (element) => element.tagName === "INPUT"
    );
    expect(fileInput?.wasClicked).toBe(true);
    expect(container.children).not.toContain(fileInput);
  });
});
