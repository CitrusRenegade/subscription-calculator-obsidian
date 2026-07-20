import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import type { SubscriptionStore } from "../data/SubscriptionStore";
import { getOpenableServiceUrl } from "../icons/url";
import type { CurrencyRegistry } from "../money/CurrencyRegistry";
import type { IconMode, SubscriptionItem } from "../types";

export class EditSubscriptionModal extends Modal {
  private name: string;
  private serviceUrl: string;
  private startDate: string;
  private iconMode: IconMode;
  private emoji: string;

  constructor(
    app: App,
    private readonly store: SubscriptionStore,
    private readonly registry: CurrencyRegistry,
    private readonly item: SubscriptionItem
  ) {
    super(app);
    this.name = item.name;
    this.serviceUrl = item.serviceUrl ?? "";
    this.startDate = item.startDate ?? "";
    this.iconMode = item.icon.mode;
    this.emoji = item.icon.emoji ?? "";
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("subscription-calculator-modal");
    contentEl.createEl("h2", { text: "Edit subscription" });

    new Setting(contentEl).setName("Name").addText((text) =>
      text.setValue(this.name).onChange((value) => {
        this.name = value;
      })
    );

    let openUrlButton: ButtonComponent | undefined;
    const serviceUrlSetting = new Setting(contentEl)
      .setName("Service URL")
      .addText((text) =>
        text.setValue(this.serviceUrl).onChange((value) => {
          this.serviceUrl = value;
          openUrlButton?.setDisabled(!getOpenableServiceUrl(value));
        })
      )
      .addButton((button) => {
        openUrlButton = button
          .setButtonText("Open URL")
          .setDisabled(!getOpenableServiceUrl(this.serviceUrl))
          .onClick(() => {
            const url = getOpenableServiceUrl(this.serviceUrl);
            if (url) contentEl.ownerDocument.defaultView?.open(url, "_blank");
          });
      });
    serviceUrlSetting.settingEl.addClass("subscription-calculator-service-url-setting");

    new Setting(contentEl)
      .setName("Start date")
      .setDesc("Optional. Used to calculate the next payment.")
      .addText((text) => {
        text.inputEl.type = "date";
        text.setValue(this.startDate).onChange((value) => {
          this.startDate = value;
        });
      });

    new Setting(contentEl).setName("Icon mode").addDropdown((dropdown) =>
      dropdown
        .addOption("auto", "Auto favicon")
        .addOption("emoji", "Emoji")
        .addOption("none", "None")
        .setValue(this.iconMode)
        .onChange((value) => {
          this.iconMode = value as IconMode;
          this.onOpen();
        })
    );

    if (this.iconMode === "emoji") {
      new Setting(contentEl).setName("Emoji").addText((text) =>
        text.setValue(this.emoji).onChange((value) => {
          this.emoji = value;
        })
      );
    }

    new Setting(contentEl)
      .setName("Icon cache")
      .setDesc("Fetching happens only on add, URL changes, or this explicit refresh.")
      .addButton((button) =>
        button.setButtonText("Refresh icon").onClick(() => void this.refreshIcon())
      )
      .addButton((button) =>
        button.setButtonText("Clear icon").onClick(() => void this.clearIcon())
      );

    new Setting(contentEl).addButton((button) =>
      button.setButtonText("Save").setCta().onClick(() => void this.save())
    );
  }

  private async save(): Promise<void> {
    if (await this.saveChanges()) {
      this.close();
    }
  }

  private async saveChanges(): Promise<boolean> {
    try {
      await this.store.updateSubscription(this.item.id, {
        name: this.name,
        serviceUrl: this.serviceUrl,
        startDate: this.startDate,
        icon: {
          mode: this.iconMode,
          emoji: this.emoji,
        },
      });
      return true;
    } catch (e) {
      new Notice(e instanceof Error ? e.message : "Failed to save subscription");
      return false;
    }
  }

  private async refreshIcon(): Promise<void> {
    const saved = await this.saveChanges();
    if (!saved) return;

    const refreshed = await this.store.refreshIcon(this.item.id);
    new Notice(refreshed ? "Icon refreshed" : "No icon fetched");
  }

  private async clearIcon(): Promise<void> {
    await this.store.clearIcon(this.item.id);
    new Notice("Icon cleared");
    this.close();
  }
}
