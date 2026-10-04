export class MockElement {
  readonly children: MockElement[] = [];
  readonly classes = new Set<string>();
  readonly attributes = new Map<string, string>();

  empty(): void {
    this.children.length = 0;
  }

  addClass(className: string): void {
    this.classes.add(className);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  createEl(): MockElement {
    const child = new MockElement();
    this.children.push(child);
    return child;
  }

  createSpan(): MockElement {
    const child = new MockElement();
    this.children.push(child);
    return child;
  }

  addEventListener(_event: string, _listener: () => void): void {}
}

export class WorkspaceLeaf {}

export class App {
  readonly workspace = {
    getLeavesOfType: () => [] as WorkspaceLeaf[],
    setActiveLeaf: () => undefined,
    rightSplit: { expand: () => undefined },
    getRightLeaf: () => new WorkspaceLeaf(),
    getLeaf: () => new WorkspaceLeaf(),
  };
}

export class Plugin {
  readonly app = new App();
  readonly registeredViewTypes: string[] = [];
  readonly cliHandlers = new Map<string, (params: Record<string, string>) => string | Promise<string>>();

  registerCliHandler(command: string, _description: string, _flags: unknown,
    handler: (params: Record<string, string>) => string | Promise<string>): void {
    this.cliHandlers.set(command, handler);
    this.register(() => this.cliHandlers.delete(command));
  }

  async loadData(): Promise<unknown> {
    return null;
  }

  async saveData(_data: unknown): Promise<void> {}

  registerView(viewType: string, _factory: unknown): void {
    this.registeredViewTypes.push(viewType);
  }

  addSettingTab(_tab: unknown): void {}

  addRibbonIcon(_icon: string, _title: string, _callback: () => void): void {}

  addCommand(_command: unknown): void {}

  registerDomEvent(
    _target: unknown,
    _event: string,
    _callback: () => void
  ): void {}

  register(_cleanup: () => void): void {}
}

export class PluginSettingTab {
  readonly containerEl = new MockElement();
  updateCalls = 0;

  constructor(_app: App, _plugin: Plugin) {}

  getSettingDefinitions(): unknown[] {
    return [];
  }

  getControlValue(_key: string): unknown {
    return undefined;
  }

  setControlValue(_key: string, _value: unknown): void {}

  update(): void {
    this.updateCalls += 1;
  }
}

export class SettingPage {
  readonly containerEl = new MockElement();
  title = "";

  display(): void {}
}

export class ItemView {
  readonly contentEl = new MockElement();
  readonly app = new App();

  constructor(_leaf: WorkspaceLeaf) {}
}

export class Menu {
  addItem(_callback: (item: unknown) => void): void {}

  showAtMouseEvent(_event: MouseEvent): void {}
}

export function setIcon(_element: unknown, _icon: string): void {}

export const Platform = {
  isDesktop: true,
};

export class Modal {
  readonly contentEl = new MockElement();
  isClosed = false;

  constructor(_app: App) {}

  close(): void {
    this.isClosed = true;
  }
}

export class TextComponent {
  value = "";
  inputEl = { type: "text" };
  private onChangeCallback: ((value: string) => void) | undefined;

  setValue(value: string): this {
    this.value = value;
    return this;
  }

  setPlaceholder(_placeholder: string): this {
    return this;
  }

  onChange(callback: (value: string) => void): this {
    this.onChangeCallback = callback;
    return this;
  }

  emitChange(value: string): void {
    this.value = value;
    this.onChangeCallback?.(value);
  }
}

export class ButtonComponent {
  buttonText = "";
  disabled = false;
  private onClickCallback: (() => void) | undefined;

  setButtonText(value: string): this {
    this.buttonText = value;
    return this;
  }

  setCta(): this {
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
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

export class DropdownComponent {
  value = "";
  private onChangeCallback: ((value: string) => void) | undefined;

  addOption(_value: string, _display: string): this {
    return this;
  }

  setValue(value: string): this {
    this.value = value;
    return this;
  }

  onChange(callback: (value: string) => void): this {
    this.onChangeCallback = callback;
    return this;
  }

  emitChange(value: string): void {
    this.value = value;
    this.onChangeCallback?.(value);
  }
}

export class Setting {
  static readonly instances: Setting[] = [];

  readonly settingEl = new MockElement();
  readonly controlEl = new MockElement();
  readonly texts: TextComponent[] = [];
  readonly buttons: ButtonComponent[] = [];
  readonly dropdowns: DropdownComponent[] = [];
  name = "";

  constructor(_container: MockElement) {
    Setting.instances.push(this);
  }

  static reset(): void {
    Setting.instances.length = 0;
  }

  setName(name: string): this {
    this.name = name;
    return this;
  }

  setDesc(_description: string): this {
    return this;
  }

  addText(callback: (component: TextComponent) => void): this {
    const component = new TextComponent();
    this.texts.push(component);
    callback(component);
    return this;
  }

  addDropdown(callback: (component: DropdownComponent) => void): this {
    const component = new DropdownComponent();
    this.dropdowns.push(component);
    callback(component);
    return this;
  }

  addButton(callback: (component: ButtonComponent) => void): this {
    const component = new ButtonComponent();
    this.buttons.push(component);
    callback(component);
    return this;
  }
}

export class Notice {
  static readonly messages: string[] = [];

  constructor(readonly message: string) {
    Notice.messages.push(message);
  }

  static reset(): void {
    Notice.messages.length = 0;
  }
}

export async function requestUrl(): Promise<never> {
  throw new Error("requestUrl was not mocked");
}
