import type { Modal } from "obsidian";

const openModals = new WeakMap<Document, Map<string, Modal>>();
let closingWindow: Window | undefined;
interface WindowContext {
  owner: Document;
  previousWindow: Window;
  previousDocument: Document;
  closed: boolean;
}
const contexts: WindowContext[] = [];

function releaseContext(context: WindowContext): void {
  context.closed = true;
  // Removal may close the parent editor before its confirmation. Unwind only
  // when all child dialogs have closed, without overwriting a newer window choice.
  while (contexts[contexts.length - 1]?.closed) {
    const current = contexts.pop()!;
    if (window.activeDocument !== current.owner || window.activeWindow !== current.owner.defaultView) continue;
    const previousClosed = current.previousWindow.closed || current.previousWindow === closingWindow;
    window.activeWindow = previousClosed ? window : current.previousWindow;
    window.activeDocument = previousClosed ? document : current.previousDocument;
  }
}

/** Modal.open() reads Obsidian's shared active window, even for clicks in another window. */
export function openModalInDocument(createModal: () => Modal, owner: Document, key?: string): void {
  const ownerWindow = owner.defaultView;
  if (!ownerWindow || ownerWindow.closed || ownerWindow === closingWindow) throw new Error("Cannot open a dialog without its source window.");
  let entries = openModals.get(owner);
  if (!entries) { entries = new Map(); openModals.set(owner, entries); }
  const existing = key ? entries.get(key) : undefined;
  if (existing?.contentEl.isConnected) {
    window.activeWindow = ownerWindow;
    window.activeDocument = owner;
    if (!existing.contentEl.contains(owner.activeElement)) {
      existing.contentEl.querySelector<HTMLElement>("input, select, button")?.focus();
    }
    return;
  }
  const context: WindowContext = { owner, previousWindow: window.activeWindow, previousDocument: window.activeDocument, closed: false };
  contexts.push(context);
  let modal: Modal | undefined;
  let teardown: (() => void) | undefined;
  const release = () => {
    if (context.closed) return;
    if (teardown) ownerWindow.removeEventListener("pagehide", teardown);
    if (key && entries.get(key) === modal) entries.delete(key);
    releaseContext(context);
  };
  try {
    // Keep the source context for the dialog's entire keyboard lifetime.
    window.activeWindow = ownerWindow;
    window.activeDocument = owner;
    modal = createModal();
    if (key) entries.set(key, modal);
    modal.setCloseCallback(release);
    // Window destruction bypasses the dialog's keyboard lifetime; Obsidian's close
    // sweep cannot surface interactive dismissal, so release the context here.
    teardown = () => {
      if (context.closed || !modal) return;
      const previousClosingWindow = closingWindow;
      closingWindow = ownerWindow;
      const teardownAware = modal as Modal & { forceCloseOnWindowTeardown?: unknown };
      try {
        if (typeof teardownAware.forceCloseOnWindowTeardown === "function") {
          (teardownAware as { forceCloseOnWindowTeardown(): void }).forceCloseOnWindowTeardown();
        } else {
          modal.close();
        }
      } finally {
        try { release(); } finally { closingWindow = previousClosingWindow; }
      }
    };
    // Register before Modal.open() installs its own pagehide handler, which calls
    // the interactive close override. beforeunload may still be cancelled.
    ownerWindow.addEventListener("pagehide", teardown, { once: true });
    modal.open();
  } catch (error) {
    release();
    throw error;
  }
}
