import { App, Modal, Notice, Setting } from "obsidian";
import type { SubscriptionStore } from "../data/SubscriptionStore";
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

    new Setting(contentEl).setName("Service URL").addText((text) =>
      text.setValue(this.serviceUrl).onChange((value) => {
        this.serviceUrl = value;
      })
    );

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
      this.close();
    } catch (e) {
      new Notice(e instanceof Error ? e.message : "Failed to save subscription");
    }
  }

  private async refreshIcon(): Promise<void> {
    await this.save();
    const refreshed = await this.store.refreshIcon(this.item.id);
    new Notice(refreshed ? "Icon refreshed" : "No icon fetched");
  }

  private async clearIcon(): Promise<void> {
    await this.store.clearIcon(this.item.id);
    new Notice("Icon cleared");
    this.close();
  }
}
