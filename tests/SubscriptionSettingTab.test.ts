import { describe, expect, it, vi } from "vitest";

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
    private onClickCallback: (() => void) | undefined;

    setButtonText(value: string): this {
      this.buttonText = value;
      return this;
    }

    onClick(callback: () => void): this {
      this.onClickCallback = callback;
      return this;
    }

    click(): void {
      this.onClickCallback?.();
    }
  }

  class Setting {
    static readonly instances: Setting[] = [];
    readonly buttons: MockButton[] = [];
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

    setDesc(_value: string): this {
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
    updateCalls = 0;
    readonly containerEl = new MockElement(new MockDocument());

    constructor(
      readonly app: App,
      readonly plugin: unknown
    ) {}

    update(): void {
      this.updateCalls++;
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

type SearchControl = {
  type: string;
  key: string;
  options?: Record<string, string>;
};

function getSearchControl(definition: unknown): {
  name: string;
  control: SearchControl;
} {
  if (
    typeof definition !== "object" ||
    definition === null ||
    !("name" in definition) ||
    typeof definition.name !== "string" ||
    !("control" in definition) ||
    typeof definition.control !== "object" ||
    definition.control === null ||
    !("type" in definition.control) ||
    typeof definition.control.type !== "string" ||
    !("key" in definition.control) ||
    typeof definition.control.key !== "string"
  ) {
    throw new Error("Expected a searchable setting control");
  }

  let options: Record<string, string> | undefined;
  if (
    "options" in definition.control &&
    typeof definition.control.options === "object" &&
    definition.control.options !== null
  ) {
    options = {};
    for (const [key, value] of Object.entries(definition.control.options)) {
      if (typeof value === "string") options[key] = value;
    }
  }
  return {
    name: definition.name,
    control: { type: definition.control.type, key: definition.control.key, options },
  };
}

function getImperativeDefinition(definition: unknown): {
  name: string;
  searchable: false;
  render: (setting: unknown, group: unknown) => unknown;
} {
  if (
    typeof definition !== "object" ||
    definition === null ||
    !("name" in definition) ||
    typeof definition.name !== "string" ||
    !("searchable" in definition) ||
    definition.searchable !== false ||
    !("render" in definition) ||
    typeof definition.render !== "function"
  ) {
    throw new Error("Expected a non-searchable imperative setting definition");
  }

  return {
    name: definition.name,
    searchable: false,
    render: definition.render as (setting: unknown, group: unknown) => unknown,
  };
}

describe("SubscriptionSettingTab settings search", () => {
  it("exposes persisted controls for search and retains imperative settings sections", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const savePluginData = vi.fn().mockResolvedValue(undefined);
    const plugin = {
      data: {
        settings: {
          openMode: "right-sidebar",
          defaultCurrency: "USD",
          showDisabled: false,
          faviconProvider: "google-s2",
          confirmBeforeDelete: true,
          moneyDisplayPrecision: 0,
          floatingYearlyTotal: false,
          sortMode: "alphabetical",
          sortDirection: "ascending",
        },
        customCurrencies: [],
      },
      currencyRegistry: {
        listSelectable: () => [
          {
            code: "USD",
            label: "USD",
            amountMarker: "$",
            scale: 2,
            source: "builtin",
          },
          {
            code: "EUR",
            label: "EUR",
            amountMarker: "€",
            scale: 2,
            source: "builtin",
          },
        ],
      },
      store: { saveSettings },
      savePluginData,
    };
    const tab = new SubscriptionSettingTab(
      {} as never,
      plugin as never
    );

    const definitions = tab.getSettingDefinitions();
    expect(definitions).toHaveLength(9);
    const controls = definitions
      .filter((definition) => typeof definition === "object" && definition !== null && "control" in definition)
      .map(getSearchControl);

    expect(controls).toEqual([
      {
        name: "Open subscriptions in",
        control: { type: "dropdown", key: "openMode", options: {
          "right-sidebar": "Right sidebar",
          "main-tab": "Main tab",
        } },
      },
      {
        name: "Default currency",
        control: { type: "dropdown", key: "defaultCurrency", options: {
          USD: "USD $",
          EUR: "EUR €",
        } },
      },
      {
        name: "More precise totals",
        control: { type: "toggle", key: "moneyDisplayPrecision", options: undefined },
      },
      {
        name: "Total position",
        control: { type: "toggle", key: "floatingYearlyTotal", options: undefined },
      },
      {
        name: "Favicon provider",
        control: { type: "dropdown", key: "faviconProvider", options: {
          "google-s2": "Google S2",
          none: "Disabled",
        } },
      },
      {
        name: "Confirm before delete",
        control: { type: "toggle", key: "confirmBeforeDelete", options: undefined },
      },
    ]);

    expect(definitions
      .filter((definition) => typeof definition === "object" && definition !== null && "render" in definition)
      .map(getImperativeDefinition)
      .map(({ name, searchable }) => ({ name, searchable }))
    ).toEqual([
      { name: "Refresh all icons", searchable: false },
      { name: "Backup and restore", searchable: false },
      { name: "Custom currencies", searchable: false },
    ]);

    await tab.setControlValue("defaultCurrency", "EUR");
    expect(plugin.data.settings.defaultCurrency).toBe("EUR");
    expect(saveSettings).toHaveBeenCalledOnce();

    await tab.setControlValue("openMode", "main-tab");
    expect(plugin.data.settings.openMode).toBe("main-tab");
    expect(savePluginData).toHaveBeenCalledOnce();

    await tab.setControlValue("moneyDisplayPrecision", true);
    expect(plugin.data.settings.moneyDisplayPrecision).toBe(1);
    expect(tab.getControlValue("moneyDisplayPrecision")).toBe(true);
    await tab.setControlValue("moneyDisplayPrecision", false);
    expect(plugin.data.settings.moneyDisplayPrecision).toBe(0);
    expect(tab.getControlValue("moneyDisplayPrecision")).toBe(false);

    await tab.setControlValue("floatingYearlyTotal", true);
    expect(plugin.data.settings.floatingYearlyTotal).toBe(true);

    await tab.setControlValue("faviconProvider", "none");
    expect(plugin.data.settings.faviconProvider).toBe("none");
    expect((tab as unknown as { updateCalls: number }).updateCalls).toBe(1);

    await tab.setControlValue("confirmBeforeDelete", false);
    expect(plugin.data.settings.confirmBeforeDelete).toBe(false);
    expect(saveSettings).toHaveBeenCalledTimes(4);
    expect(savePluginData).toHaveBeenCalledTimes(3);
  });

  it("opens Restore JSON's detached file input from the settings container", () => {
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

  it("updates setting definitions after restoring a backup", async () => {
    const restoreBackupJson = vi.fn().mockResolvedValue({
      subscriptions: { imported: 1, skipped: 0 },
      customCurrencies: { imported: 0, skipped: 0 },
    });
    const tab = new SubscriptionSettingTab(
      {} as never,
      { restoreBackupJson } as never
    );
    type RestoreButton = {
      setDisabled(disabled: boolean): RestoreButton;
      setButtonText(text: string): RestoreButton;
    };
    const button = {} as RestoreButton;
    button.setDisabled = () => button;
    button.setButtonText = () => button;

    await (
      tab as unknown as {
        restoreBackupFile(file: File, button: RestoreButton): Promise<void>;
      }
    ).restoreBackupFile(
      { text: async () => "{}" } as File,
      button
    );

    expect(restoreBackupJson).toHaveBeenCalledOnce();
    expect((tab as unknown as { updateCalls: number }).updateCalls).toBe(1);
  });
});
