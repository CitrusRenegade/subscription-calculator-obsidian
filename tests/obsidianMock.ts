export class MockElement {
  readonly children: MockElement[] = [];
  readonly classes = new Set<string>();

  empty(): void {
    this.children.length = 0;
  }

  addClass(className: string): void {
    this.classes.add(className);
  }

  createEl(): MockElement {
    const child = new MockElement();
    this.children.push(child);
    return child;
  }
}

export class App {}

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
  private onChangeCallback: ((value: string) => void) | undefined;

  addOption(_value: string, _display: string): this {
    return this;
  }

  setValue(_value: string): this {
    return this;
  }

  onChange(callback: (value: string) => void): this {
    this.onChangeCallback = callback;
    return this;
  }
}

export class Setting {
  static readonly instances: Setting[] = [];

  readonly settingEl = new MockElement();
  readonly controlEl = new MockElement();
  readonly texts: TextComponent[] = [];
  readonly buttons: ButtonComponent[] = [];
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
    callback(new DropdownComponent());
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
  constructor(readonly message: string) {}
}
