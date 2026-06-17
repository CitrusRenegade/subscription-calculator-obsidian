import { App, Modal, Setting } from "obsidian";

export class ConfirmDeleteModal extends Modal {
  constructor(
    app: App,
    private readonly subscriptionName: string,
    private readonly onConfirm: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("subscription-calculator-modal");
    contentEl.createEl("h2", { text: "Delete subscription?" });
    contentEl.createEl("p", {
      text: `${this.subscriptionName} will be removed permanently.`,
    });
    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => this.close())
      )
      .addButton((button) =>
        button
          .setButtonText("Delete")
          .setWarning()
          .onClick(() => {
            this.onConfirm();
            this.close();
          })
      );
  }
}

