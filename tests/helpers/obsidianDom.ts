// A thin Obsidian UI boundary over jsdom. No layout or native host behavior is emulated.
interface ElementOptions { cls?: string | string[]; text?: string; attr?: Record<string, string>; }
function appendElement(parent: Node, tag: string, options: ElementOptions = {}): HTMLElement {
  const range = parent.ownerDocument!.createRange();
  range.selectNodeContents(parent);
  // Literal templates keep this bounded adapter's native parser boundary explicit.
  let fragment: DocumentFragment;
  switch (tag) {
    case "div": fragment = range.createContextualFragment("<div></div>"); break;
    case "span": fragment = range.createContextualFragment("<span></span>"); break;
    case "input": fragment = range.createContextualFragment("<input>"); break;
    case "button": fragment = range.createContextualFragment("<button></button>"); break;
    case "select": fragment = range.createContextualFragment("<select></select>"); break;
    case "option": fragment = range.createContextualFragment("<option></option>"); break;
    case "label": fragment = range.createContextualFragment("<label></label>"); break;
    case "h2": fragment = range.createContextualFragment("<h2></h2>"); break;
    case "p": fragment = range.createContextualFragment("<p></p>"); break;
    case "a": fragment = range.createContextualFragment("<a></a>"); break;
    case "iframe": fragment = range.createContextualFragment("<iframe></iframe>"); break;
    case "img": fragment = range.createContextualFragment("<img>"); break;
    default: throw new Error(`Unsupported DOM tag: ${tag}`);
  }
  const element = fragment.firstElementChild as HTMLElement;
  const classes = Array.isArray(options.cls) ? options.cls : options.cls?.split(" ") ?? [];
  element.classList.add(...classes.filter(Boolean));
  if (options.text !== undefined) element.textContent = options.text;
  for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, value);
  parent.appendChild(element);
  return element;
}
function installBuilders(prototype: object): void {
  Object.defineProperties(prototype, {
    createEl: { configurable: true, value(this: Node, tag: string, options: ElementOptions = {}) {
      return appendElement(this, tag, options);
    } },
    createDiv: { configurable: true, value(this: HTMLElement, options?: ElementOptions) { return appendElement(this, "div", options); } },
    createSpan: { configurable: true, value(this: HTMLElement, options?: ElementOptions) { return appendElement(this, "span", options); } },
    empty: { configurable: true, value(this: HTMLElement) { this.replaceChildren(); } },
    setText: { configurable: true, value(this: HTMLElement, text: string) { this.textContent = text; } },
    addClass: { configurable: true, value(this: HTMLElement, ...classes: string[]) { this.classList.add(...classes); } },
    removeClass: { configurable: true, value(this: HTMLElement, ...classes: string[]) { this.classList.remove(...classes); } },
    setAttr: { configurable: true, value(this: HTMLElement, name: string, value: string) { this.setAttribute(name, value); } },
  });
}
export function installObsidianDomHelpers(owner: Window = window): void {
  const constructors = owner as Window & { HTMLElement: typeof HTMLElement; DocumentFragment: typeof DocumentFragment };
  installBuilders(constructors.HTMLElement.prototype);
  installBuilders(constructors.DocumentFragment.prototype);
}
installObsidianDomHelpers();
Object.defineProperty(window, "createFragment", { configurable: true, value: () => document.createRange().createContextualFragment("") });

function mount(doc: Document): HTMLDivElement { return appendElement(doc.body, "div") as HTMLDivElement; }
export class Workspace {
  private readonly events = new EventTarget();
  readonly leaves: WorkspaceLeaf[] = [];
  readonly rightSplit = { expand: () => undefined };
  on(name: string, callback: (leaf: WorkspaceLeaf | null) => void): { name: string; listener: EventListener } {
    const listener: EventListener = event => callback((event as CustomEvent<WorkspaceLeaf | null>).detail);
    this.events.addEventListener(name, listener);
    return { name, listener };
  }
  offref(ref: { name: string; listener: EventListener }): void { this.events.removeEventListener(ref.name, ref.listener); }
  trigger(name: string, leaf: WorkspaceLeaf | null = null): void { this.events.dispatchEvent(new CustomEvent(name, { detail: leaf })); }
  getLeavesOfType(type: string): WorkspaceLeaf[] { return this.leaves.filter(leaf => leaf.view?.getViewType() === type); }
  setActiveLeaf(leaf: WorkspaceLeaf): void { this.trigger("active-leaf-change", leaf); }
}
export class App { readonly workspace = new Workspace(); constructor(readonly document: Document = window.document) {} }
export class WorkspaceLeaf {
  view?: ItemView;
  constructor(readonly app = new App()) { app.workspace.leaves.push(this); }
}
export class ItemView {
  readonly app: App;
  readonly contentEl: HTMLDivElement;
  constructor(readonly leaf: WorkspaceLeaf) { this.app = leaf.app; this.contentEl = mount(this.app.document); leaf.view = this; }
  getViewType(): string { return ""; }
}
export class Modal {
  readonly contentEl: HTMLDivElement;
  isClosed = false;
  constructor(readonly app: App) { this.contentEl = mount(app.document); }
  open(): void { this.isClosed = false; this.onOpen(); }
  onOpen(): void {}
  close(): void { this.isClosed = true; this.contentEl.remove(); }
}
export class Notice {
  static readonly messages: string[] = [];
  constructor(message: string) { Notice.messages.push(message); }
  static reset(): void { Notice.messages.length = 0; }
}
export class TextComponent {
  readonly inputEl: HTMLInputElement;
  constructor(container: HTMLElement) { this.inputEl = container.createEl("input", { attr: { type: "text" } }); }
  setValue(value: string): this { this.inputEl.value = value; return this; }
  setPlaceholder(value: string): this { this.inputEl.placeholder = value; return this; }
  onChange(callback: (value: string) => void): this { this.inputEl.addEventListener("input", () => callback(this.inputEl.value)); return this; }
}
export class ButtonComponent {
  readonly buttonEl: HTMLButtonElement;
  constructor(container: HTMLElement) { this.buttonEl = container.createEl("button", { attr: { type: "button" } }); }
  setButtonText(value: string): this { this.buttonEl.textContent = value; return this; }
  setDisabled(value: boolean): this { this.buttonEl.disabled = value; return this; }
  setCta(): this { this.buttonEl.classList.add("mod-cta"); return this; }
  onClick(callback: () => void | Promise<void>): this { this.buttonEl.addEventListener("click", () => { void callback(); }); return this; }
}
export class DropdownComponent {
  readonly selectEl: HTMLSelectElement;
  constructor(container: HTMLElement) { this.selectEl = container.createEl("select"); }
  addOption(value: string, text: string): this { this.selectEl.createEl("option", { text, attr: { value } }); return this; }
  setValue(value: string): this { this.selectEl.value = value; return this; }
  onChange(callback: (value: string) => void): this { this.selectEl.addEventListener("change", () => callback(this.selectEl.value)); return this; }
}
export class ToggleComponent {
  readonly toggleEl: HTMLInputElement;
  constructor(container: HTMLElement) { this.toggleEl = container.createEl("input", { attr: { type: "checkbox" } }); }
  setValue(value: boolean): this { this.toggleEl.checked = value; return this; }
  setDisabled(value: boolean): this { this.toggleEl.disabled = value; return this; }
  onChange(callback: (value: boolean) => void): this { this.toggleEl.addEventListener("change", () => callback(this.toggleEl.checked)); return this; }
}
export class Setting {
  static readonly instances: Setting[] = [];
  readonly settingEl: HTMLDivElement;
  readonly controlEl: HTMLDivElement;
  readonly nameEl: HTMLDivElement;
  readonly descEl: HTMLDivElement;
  readonly texts: TextComponent[] = [];
  readonly buttons: ButtonComponent[] = [];
  readonly dropdowns: DropdownComponent[] = [];
  readonly toggles: ToggleComponent[] = [];
  constructor(container: HTMLElement) {
    this.settingEl = container.createDiv({ cls: "setting-item" });
    this.nameEl = this.settingEl.createDiv({ cls: "setting-item-name" });
    this.descEl = this.settingEl.createDiv({ cls: "setting-item-description" });
    this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
    Setting.instances.push(this);
  }
  get name(): string { return this.nameEl.textContent ?? ""; }
  setName(value: string): this { this.nameEl.textContent = value; return this; }
  setDesc(value: string | DocumentFragment): this { this.descEl.replaceChildren(value); return this; }
  setHeading(): this { this.settingEl.classList.add("setting-item-heading"); return this; }
  addText(callback: (value: TextComponent) => void): this { const value = new TextComponent(this.controlEl); this.texts.push(value); callback(value); return this; }
  addButton(callback: (value: ButtonComponent) => void): this { const value = new ButtonComponent(this.controlEl); this.buttons.push(value); callback(value); return this; }
  addDropdown(callback: (value: DropdownComponent) => void): this { const value = new DropdownComponent(this.controlEl); this.dropdowns.push(value); callback(value); return this; }
  addToggle(callback: (value: ToggleComponent) => void): this { const value = new ToggleComponent(this.controlEl); this.toggles.push(value); callback(value); return this; }
  static reset(): void { Setting.instances.length = 0; }
}
export class SettingPage { readonly containerEl = mount(document); title = ""; display(): void {} hide(): void { this.containerEl.remove(); } }
export class PluginSettingTab {
  readonly containerEl: HTMLDivElement;
  updateCalls = 0;
  constructor(readonly app: App, readonly plugin: unknown) { this.containerEl = mount(app.document); }
  update(): void { this.updateCalls++; }
}
class MenuItem {
  setTitle(_title: string | DocumentFragment): this { return this; }
  onClick(_callback: () => void): this { return this; }
}
export class Menu { addItem(callback: (item: MenuItem) => void): this { callback(new MenuItem()); return this; } showAtMouseEvent(_event: MouseEvent): void {} }
export function setIcon(element: HTMLElement, name: string): void { element.setAttribute("data-icon", name); }
export function resetObsidianDom(): void { document.body.replaceChildren(); Setting.reset(); Notice.reset(); }
export function changeInput(input: HTMLInputElement, value: string): void { input.value = value; input.dispatchEvent(new input.ownerDocument.defaultView!.Event("input", { bubbles: true })); }
export function changeSelect(select: HTMLSelectElement, value: string): void { select.value = value; select.dispatchEvent(new select.ownerDocument.defaultView!.Event("change", { bubbles: true })); }
export function findSetting(container: HTMLElement, name: string): Setting {
  const setting = [...Setting.instances].reverse().find(value => container.contains(value.settingEl) && value.name === name);
  if (!setting) throw new Error(`Setting not found: ${name}`);
  return setting;
}
export function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(value => value.textContent === text);
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

export async function requestUrl(): Promise<never> { throw new Error("Unexpected network request in DOM interaction test"); }
