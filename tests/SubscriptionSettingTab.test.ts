import { describe, expect, it, vi } from "vitest";

vi.stubGlobal(
  "createFragment",
  () => ({ append: () => undefined }) as unknown as DocumentFragment
);

vi.mock("obsidian", () => {
  class App {}

  class MockDocument {
    readonly createdElements: MockElement[] = [];
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

    constructor(
      readonly ownerDocument: MockDocument,
      readonly tagName = "div"
    ) {}

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

    empty(): void {
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
    private onClickCallback: (() => void | Promise<void>) | undefined;

    setButtonText(value: string): this {
      this.buttonText = value;
      return this;
    }

    setCta(): this {
      return this;
    }

    setDisabled(_disabled: boolean): this {
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
    setPlaceholder(_value: string): this {
      return this;
    }

    setValue(_value: string): this {
      return this;
    }

    onChange(_callback: (value: string) => void): this {
      return this;
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
    name = "";

    constructor(_containerEl: MockElement) {
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
      callback(new MockText());
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

    constructor(
      readonly app: App,
      readonly plugin: unknown
    ) {}

    getSettingDefinitions(): unknown[] {
      return [];
    }
  }

  return {
    App,
    MockDocument,
    MockElement,
    Notice: class Notice {},
    PluginSettingTab,
    Setting,
  };
});

type MockElementLike = {
  children: MockElementLike[];
  tagName: string;
  wasClicked: boolean;
};

type MockDocumentLike = {
  createdElements: MockElementLike[];
};

const mockedObsidian = (await import("obsidian")) as unknown as {
  MockDocument: new () => MockDocumentLike;
  MockElement: new (document: MockDocumentLike) => MockElementLike;
  Setting: unknown;
};
const { MockDocument, MockElement, Setting } = mockedObsidian;
const { SubscriptionSettingTab } = await import(
  "../src/settings/SubscriptionSettingTab"
);

function createPlugin() {
  return {
    data: {
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
    },
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
      saveSettings: vi.fn(),
      updateCustomCurrency: vi.fn(),
    },
    savePluginData: vi.fn(),
  };
}

describe("SubscriptionSettingTab", () => {
  it("uses one manual renderer for Obsidian 1.5 through current clients", () => {
    const settings = Setting as {
      instances: Array<{ name: string }>;
      reset(): void;
    };
    settings.reset();
    const tab = new SubscriptionSettingTab({} as never, createPlugin() as never);

    expect(
      (tab as unknown as { getSettingDefinitions(): unknown[] }).getSettingDefinitions()
    ).toEqual([]);
    tab.display();

    expect(settings.instances.map((setting) => setting.name)).toEqual(
      expect.arrayContaining([
        "Backup and restore",
        "Export backup",
        "Restore backup",
        "Custom currencies",
      ])
    );
  });

  it("persists manual select and toggle controls", async () => {
    const plugin = createPlugin();
    const settings = Setting as {
      instances: Array<{
        dropdowns: Array<{ change(value: string): Promise<void> }>;
        name: string;
        toggles: Array<{ change(value: boolean): Promise<void> }>;
      }>;
      reset(): void;
    };
    settings.reset();
    const tab = new SubscriptionSettingTab({} as never, plugin as never);
    tab.display();

    const openMode = settings.instances.find(
      (setting) => setting.name === "Open subscriptions in"
    );
    await openMode?.dropdowns[0]?.change("main-tab");
    expect(plugin.data.settings.openMode).toBe("main-tab");
    expect(plugin.savePluginData).toHaveBeenCalledOnce();

    const defaultCurrency = settings.instances.find(
      (setting) => setting.name === "Default currency"
    );
    await defaultCurrency?.dropdowns[0]?.change("USD");
    expect(plugin.store.saveSettings).toHaveBeenCalledOnce();

    const confirmBeforeDelete = settings.instances.find(
      (setting) => setting.name === "Confirm before delete"
    );
    await confirmBeforeDelete?.toggles[0]?.change(false);
    expect(plugin.data.settings.confirmBeforeDelete).toBe(false);
    expect(plugin.savePluginData).toHaveBeenCalledTimes(2);
  });

  it("refreshes the manual settings after custom-currency actions", async () => {
    const plugin = createPlugin();
    plugin.data.customCurrencies.push({
      amountMarker: "¤",
      code: "TOK",
      label: "TOK",
      scale: 2,
      source: "custom",
    });
    const settings = Setting as {
      instances: Array<{
        buttons: Array<{ buttonText: string; click(): Promise<void> }>;
      }>;
      reset(): void;
    };
    settings.reset();
    const tab = new SubscriptionSettingTab({} as never, plugin as never);
    tab.display();

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

  it("rerenders manual settings after restoring a backup", async () => {
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
    tab.display();
    const initialRenderSettingCount = settings.instances.length;
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
    expect(settings.instances.length).toBeGreaterThan(initialRenderSettingCount);
  });

  it("opens Restore JSON's detached file input from the manual settings section", () => {
    const document = new MockDocument();
    const container = new MockElement(document);
    const tab = new SubscriptionSettingTab({} as never, {} as never);
    const settings = Setting as {
      instances: Array<{
        name: string;
        buttons: Array<{ buttonText: string; click(): void }>;
      }>;
      reset(): void;
    };
    settings.reset();

    (
      tab as unknown as {
        renderBackupAndRestoreControls(containerEl: HTMLElement): void;
      }
    ).renderBackupAndRestoreControls(container as never);

    const restoreButton = settings.instances
      .find((setting) => setting.name === "Restore backup")
      ?.buttons.find((button) => button.buttonText === "Restore JSON");
    restoreButton?.click();

    const fileInput = document.createdElements.find(
      (element) => element.tagName === "input"
    );
    expect(fileInput?.wasClicked).toBe(true);
    expect(container.children).not.toContain(fileInput);
  });
});
