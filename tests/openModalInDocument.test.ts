// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal, type App as ObsidianApp } from "obsidian";
import { App, installObsidianDomHelpers, resetObsidianDom } from "./helpers/obsidianDom";
import { openModalInDocument } from "../src/ui/components/openModalInDocument";
vi.mock("obsidian", () => import("./helpers/obsidianDom"));

describe("opening a modal in its source window", () => {
  const constructed: Modal[] = [];
  beforeEach(resetObsidianDom);
  afterEach(() => { for (const modal of constructed.splice(0).reverse()) modal.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  function setup() {
    const frame = document.body.createEl("iframe");
    installObsidianDomHelpers(frame.contentWindow!);
    vi.stubGlobal("activeWindow", frame.contentWindow);
    vi.stubGlobal("activeDocument", frame.contentDocument);
    const nativeOpen = vi.spyOn(Modal.prototype, "open").mockImplementation(function (this: Modal) {
      window.activeDocument.body.append(this.contentEl);
      void this.onOpen();
    });
    const modal = () => { const instance = new Modal(new App() as unknown as ObsidianApp); constructed.push(instance); return instance; };
    return { frame, nativeOpen, modal };
  }
  it("restores the previous window after closing, rather than during opening", () => {
    const { modal, frame } = setup(); const dialog = modal();
    openModalInDocument(() => dialog, document, "subscription-form");
    expect(window.activeDocument).toBe(document);
    dialog.close();
    expect(window.activeWindow === frame.contentWindow).toBe(true);
    expect(window.activeDocument === frame.contentDocument).toBe(true);
  });
  it("waits for a child confirmation to close before restoring a closed parent's context", () => {
    const { modal, frame } = setup(); const parent = modal(); const child = modal();
    openModalInDocument(() => parent, document, "subscription-form");
    openModalInDocument(() => child, document);
    parent.close(); expect(window.activeDocument).toBe(document);
    child.close(); expect(window.activeDocument === frame.contentDocument).toBe(true);
  });
  it("does not overwrite a window selected after the dialog opened", () => {
    const { modal } = setup(); const dialog = modal();
    openModalInDocument(() => dialog, document, "subscription-form");
    const third = document.body.createEl("iframe");
    window.activeWindow = third.contentWindow!; window.activeDocument = third.contentDocument!;
    dialog.close(); expect(window.activeWindow).toBe(third.contentWindow);
  });
  it("opens in the initiating document even when Settings is globally active", () => {
    const { modal } = setup(); const dialog = modal();
    openModalInDocument(() => dialog, document);
    expect(dialog.contentEl.ownerDocument).toBe(document);
    expect(window.activeWindow === window).toBe(true);
    expect(window.activeDocument === document).toBe(true);
  });
  it("restores the global context even when opening throws", () => {
    const { frame, modal, nativeOpen } = setup();
    nativeOpen.mockImplementationOnce(() => { throw new Error("open failed"); });
    expect(() => openModalInDocument(modal, document, "subscription-form")).toThrow("open failed");
    expect(window.activeWindow === frame.contentWindow).toBe(true); expect(window.activeDocument === frame.contentDocument).toBe(true);
    openModalInDocument(modal, document, "subscription-form");
    expect(nativeOpen).toHaveBeenCalledTimes(2);
  });
  it("reuses the open form across rerenders, then permits opening after close", () => {
    const { modal, nativeOpen } = setup(); const create = vi.fn(modal);
    openModalInDocument(create, document, "subscription-form");
    openModalInDocument(create, document, "subscription-form");
    expect(nativeOpen).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    constructed[0].close(); openModalInDocument(create, document, "subscription-form");
    expect(nativeOpen).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(2);
  });
  it("allows independent forms in different source windows", () => {
    const { modal, nativeOpen, frame } = setup();
    openModalInDocument(modal, document, "subscription-form");
    openModalInDocument(modal, frame.contentDocument!, "subscription-form");
    expect(nativeOpen).toHaveBeenCalledTimes(2);
  });
  it("force-closes the dialog and unwinds the context when its window unloads", () => {
    const { modal, frame } = setup(); const dialog = modal();
    const force = vi.fn(function (this: Modal) { this.close(); });
    Object.assign(dialog, { forceCloseOnWindowTeardown: force });
    openModalInDocument(() => dialog, document, "subscription-form");
    window.dispatchEvent(new Event("pagehide"));
    expect(force).toHaveBeenCalledOnce();
    expect(window.activeWindow === frame.contentWindow).toBe(true);
    expect(window.activeDocument === frame.contentDocument).toBe(true);
  });
  it("does not tear down a dialog that already closed before the unload", () => {
    const { modal } = setup(); const dialog = modal();
    const closeSpy = vi.spyOn(dialog, "close");
    openModalInDocument(() => dialog, document, "subscription-form");
    dialog.close();
    closeSpy.mockClear();
    window.dispatchEvent(new Event("pagehide"));
    expect(closeSpy).not.toHaveBeenCalled();
  });
  it("removes window listeners after ordinary close and failed open", () => {
    const { modal, nativeOpen } = setup();
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const dialog = modal();
    openModalInDocument(() => dialog, document);
    dialog.close();
    nativeOpen.mockImplementationOnce(() => { throw new Error("open failed"); });
    expect(() => openModalInDocument(modal, document)).toThrow("open failed");
    const callbacks = add.mock.calls.filter(call => call[0] === "pagehide").map(call => call[1]);
    expect(callbacks).toHaveLength(2);
    for (const callback of callbacks) expect(remove).toHaveBeenCalledWith("pagehide", callback);
  });
  it("does not restore a window that is currently being destroyed", () => {
    const { frame, modal } = setup(); const dialog = modal();
    // Source and prior active window are the same, as for an actual focused popout.
    openModalInDocument(() => dialog, frame.contentDocument!);
    frame.contentWindow!.dispatchEvent(new Event("pagehide"));
    expect(window.activeWindow).toBe(window);
    expect(window.activeDocument).toBe(document);
  });
});
