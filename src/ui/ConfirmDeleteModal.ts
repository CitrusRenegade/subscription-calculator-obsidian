import { App, Modal, Setting } from "obsidian";

interface CompatibleDestructiveButton {
  setDestructive?: () => unknown;
  setWarning?: () => unknown;
}

function applyDestructiveButtonStyle(button: CompatibleDestructiveButton): void {
  if (button.setDestructive) {
    button.setDestructive();
    return;
  }
  button.setWarning?.();
}

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
          .then(applyDestructiveButtonStyle)
          .onClick(() => {
            this.onConfirm();
            this.close();
          })
      );
  }
}
