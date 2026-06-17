import { setIcon } from "obsidian";

export function renderAddSubscriptionCard(
  container: HTMLElement,
  onClick: () => void
): void {
  const button = container.createEl("button", {
    cls: "subscription-calculator-add-card",
  });
  const icon = button.createSpan({ cls: "subscription-calculator-add-icon" });
  setIcon(icon, "plus");
  button.createSpan({ text: "Add subscription" });
  button.addEventListener("click", onClick);
}

