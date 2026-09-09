export interface RepoSettingsRemote {
  name: string;
  url: string;
  pushUrl?: string;
}

export interface RepoSettingsIssueLinks {
  enabled: boolean;
  regex: string;
  urlTemplate: string;
}

export interface RepoSettingsData {
  repositoryName: string;
  repositoryPath: string;
  remotes: RepoSettingsRemote[];
  issueLinks: RepoSettingsIssueLinks;
}

export type RepoSettingsAction =
  | ({ type: "addRemote" } & RepoSettingsRemote)
  | ({ type: "editRemote"; originalName: string } & RepoSettingsRemote)
  | { type: "deleteRemote"; name: string }
  | { type: "fetchRemote"; name: string }
  | { type: "fetchPruneRemote"; name: string }
  | { type: "pruneTagsRemote"; name: string }
  | { type: "saveIssueLinks"; settings: RepoSettingsIssueLinks };

export type RepoSettingsActionHandler = (action: RepoSettingsAction) => void;

interface SettingsFields {
  issueEnabled: HTMLInputElement;
  issueRegex: HTMLInputElement;
  issueRegexError: HTMLElement;
  issueTemplate: HTMLInputElement;
  issueTemplateError: HTMLElement;
  remoteName: HTMLInputElement;
  remoteNameError: HTMLElement;
  remotePushUrl: HTMLInputElement;
  remoteTitle: HTMLElement;
  remoteUrl: HTMLInputElement;
  remoteUrlError: HTMLElement;
  submitRemote: HTMLButtonElement;
}

const REMOTE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]*$/u;
const REMOTE_URL_PROTOCOL_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u;
const REMOTE_URL_SCP_PATTERN = /^[^@/\s]+@[^:\s]+:[^\s]+$/u;
const CAPTURE_PLACEHOLDERS = new Set(["{0}", "{issue}"]);

let panelCount = 0;

export class RepoSettingsPanel {
  private readonly actionHandler: RepoSettingsActionHandler;
  private readonly container: HTMLElement;
  private readonly idPrefix: string;
  private readonly root: HTMLElement;
  private readonly fields = {} as SettingsFields;
  private data: RepoSettingsData;
  private editingRemoteName: string | null = null;
  private previousFocusedElement: HTMLElement | null = null;
  private remoteCancelButton!: HTMLButtonElement;

  constructor(
    container: HTMLElement,
    data: RepoSettingsData,
    actionHandler: RepoSettingsActionHandler
  ) {
    this.container = container;
    this.data = data;
    this.actionHandler = actionHandler;
    this.idPrefix = `repo-settings-${++panelCount}`;
    this.root = this.createRoot();
    this.renderContent();
    this.root.hidden = true;
    this.container.replaceChildren(this.root);
  }

  public update(data: RepoSettingsData): void {
    const activeElement = document.activeElement;
    const hadFocus = activeElement !== null && this.root.contains(activeElement);
    this.data = data;
    this.editingRemoteName = null;
    this.renderContent();
    if (hadFocus) {
      this.root.focus();
    }
  }

  public open(): void {
    if (!this.root.hidden) {
      return;
    }
    const activeElement = document.activeElement;
    this.previousFocusedElement = activeElement instanceof HTMLElement ? activeElement : null;
    this.root.hidden = false;
    this.root.focus();
  }

  public close(): void {
    if (this.root.hidden) {
      return;
    }
    this.root.hidden = true;
    const previousFocusedElement = this.previousFocusedElement;
    this.previousFocusedElement = null;
    if (previousFocusedElement !== null && previousFocusedElement.isConnected) {
      previousFocusedElement.focus();
    }
  }

  public isVisible(): boolean {
    return !this.root.hidden;
  }

  public dispose(): void {
    this.root.remove();
  }

  private createRoot(): HTMLElement {
    const root = document.createElement("section");
    root.className = "repo-settings";
    root.tabIndex = -1;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "false");
    root.setAttribute("aria-labelledby", `${this.idPrefix}-title`);
    root.setAttribute("aria-describedby", `${this.idPrefix}-description`);
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      }
    });
    return root;
  }

  private renderContent(): void {
    const closeButton = this.createButton(
      "Close repository settings",
      "Close",
      () => this.close(),
      "secondary"
    );
    closeButton.classList.add("repo-settings-close");

    const header = document.createElement("header");
    header.className = "repo-settings-header";
    header.append(this.createTitle(), this.createDescription(), closeButton);

    const main = document.createElement("div");
    main.className = "repo-settings-content";
    main.append(
      this.createRemotesSection(),
      this.createIssueLinkSection(),
      this.createComingSoonSection(
        `${this.idPrefix}-pull-requests`,
        "Pull request providers",
        "Provider integration will become available in a future release."
      ),
      this.createComingSoonSection(
        `${this.idPrefix}-export`,
        "Configuration export",
        "Sharing repository settings is not available yet."
      )
    );

    this.root.replaceChildren(header, main);
  }

  private createTitle(): HTMLElement {
    const title = document.createElement("h2");
    title.id = `${this.idPrefix}-title`;
    title.textContent = `Repository settings — ${this.data.repositoryName}`;
    return title;
  }

  private createDescription(): HTMLElement {
    const description = document.createElement("p");
    description.id = `${this.idPrefix}-description`;
    description.className = "repo-settings-description";
    description.textContent = this.data.repositoryPath;
    return description;
  }

  private createRemotesSection(): HTMLElement {
    const section = document.createElement("section");
    section.className = "repo-settings-section";
    section.setAttribute("aria-labelledby", `${this.idPrefix}-remotes-title`);

    const title = document.createElement("h3");
    title.id = `${this.idPrefix}-remotes-title`;
    title.textContent = "Remotes";

    section.append(title, this.createRemoteList(), this.createRemoteForm());
    return section;
  }

  private createRemoteList(): HTMLElement {
    const list = document.createElement("ul");
    list.className = "repo-settings-remote-list";
    list.setAttribute("aria-label", "Configured remotes");

    if (this.data.remotes.length === 0) {
      const emptyItem = document.createElement("li");
      emptyItem.className = "repo-settings-empty";
      emptyItem.textContent = "No remotes are configured.";
      list.appendChild(emptyItem);
      return list;
    }

    for (const remote of this.data.remotes) {
      list.appendChild(this.createRemoteListItem(remote));
    }
    return list;
  }

  private createRemoteListItem(remote: RepoSettingsRemote): HTMLElement {
    const item = document.createElement("li");
    item.className = "repo-settings-remote";

    const details = document.createElement("div");
    details.className = "repo-settings-remote-details";
    const name = document.createElement("span");
    name.className = "repo-settings-remote-name";
    name.textContent = remote.name;
    const url = document.createElement("span");
    url.className = "repo-settings-remote-url";
    url.textContent =
      remote.pushUrl === undefined || remote.pushUrl === remote.url
        ? remote.url
        : `${remote.url} → ${remote.pushUrl}`;
    details.append(name, url);

    const actions = document.createElement("div");
    actions.className = "repo-settings-remote-actions";
    actions.append(
      this.createButton(
        `Edit remote ${remote.name}`,
        "Edit",
        () => this.startEdit(remote),
        "secondary"
      ),
      this.createButton(
        `Delete remote ${remote.name}`,
        "Delete",
        () => {
          this.actionHandler({ type: "deleteRemote", name: remote.name });
        },
        "secondary"
      ),
      this.createButton(
        `Fetch remote ${remote.name}`,
        "Fetch",
        () => {
          this.actionHandler({ type: "fetchRemote", name: remote.name });
        },
        "secondary"
      ),
      this.createButton(
        `Fetch and prune remote ${remote.name}`,
        "Fetch prune",
        () => {
          this.actionHandler({ type: "fetchPruneRemote", name: remote.name });
        },
        "secondary"
      ),
      this.createButton(
        `Fetch and prune tags for remote ${remote.name}`,
        "Prune tags",
        () => {
          this.actionHandler({ type: "pruneTagsRemote", name: remote.name });
        },
        "secondary"
      )
    );
    item.append(details, actions);
    return item;
  }

  private createRemoteForm(): HTMLFormElement {
    const form = document.createElement("form");
    form.className = "repo-settings-form";
    form.setAttribute("aria-labelledby", `${this.idPrefix}-remote-form-title`);
    form.noValidate = true;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitRemote();
    });

    const title = document.createElement("h4");
    title.id = `${this.idPrefix}-remote-form-title`;
    title.classList.add("repo-settings-form-title");
    title.dataset.testid = "remote-form-title";
    title.textContent = "Add a remote";

    const name = this.createTextField("Remote name", "remote-name");
    const url = this.createTextField("URL", "remote-url");
    const pushUrl = this.createTextField("Push URL (optional)", "remote-push-url");
    pushUrl.input.placeholder = "Defaults to the URL";

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Add remote";

    const cancel = this.createButton(
      "Cancel remote edit",
      "Cancel",
      () => this.cancelEdit(),
      "secondary"
    );
    cancel.type = "button";
    cancel.hidden = true;
    cancel.dataset.testid = "remote-cancel";

    const actions = document.createElement("div");
    actions.className = "repo-settings-form-actions";
    actions.append(submit, cancel);
    form.append(
      title,
      this.createFormField(name.label, name.input, name.error),
      this.createFormField(url.label, url.input, url.error),
      this.createFormField(pushUrl.label, pushUrl.input, pushUrl.error),
      actions
    );

    this.fields.remoteName = name.input;
    this.fields.remoteNameError = name.error;
    this.fields.remoteUrl = url.input;
    this.fields.remoteUrlError = url.error;
    this.fields.remotePushUrl = pushUrl.input;
    this.fields.remoteTitle = title;
    this.fields.submitRemote = submit;
    this.remoteCancelButton = cancel;

    name.input.addEventListener("input", () => this.clearFieldError(name.input, name.error));
    url.input.addEventListener("input", () => this.clearFieldError(url.input, url.error));
    return form;
  }

  private createIssueLinkSection(): HTMLElement {
    const section = document.createElement("section");
    section.className = "repo-settings-section";
    section.setAttribute("aria-labelledby", `${this.idPrefix}-issues-title`);

    const title = document.createElement("h3");
    title.id = `${this.idPrefix}-issues-title`;
    title.textContent = "Issue links";

    const form = document.createElement("form");
    form.className = "repo-settings-form";
    form.noValidate = true;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitIssueLinks();
    });

    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.id = `${this.idPrefix}-issue-enabled`;
    enabled.checked = this.data.issueLinks.enabled;
    const enabledLabel = document.createElement("label");
    enabledLabel.className = "repo-settings-checkbox";
    enabledLabel.htmlFor = enabled.id;
    enabledLabel.append(enabled, document.createTextNode("Link issue references"));

    const regex = this.createTextField("Issue regex", "issue-regex");
    const template = this.createTextField("Issue URL template", "issue-template");
    template.input.placeholder = "https://example.com/issues/{0}";

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Save issue link settings";

    const fields = document.createElement("div");
    fields.className = "repo-settings-issue-fields";
    fields.append(
      this.createFormField(regex.label, regex.input, regex.error),
      this.createFormField(template.label, template.input, template.error)
    );
    form.append(enabledLabel, fields, submit);

    this.fields.issueEnabled = enabled;
    this.fields.issueRegex = regex.input;
    this.fields.issueRegexError = regex.error;
    this.fields.issueTemplate = template.input;
    this.fields.issueTemplateError = template.error;
    regex.input.value = this.data.issueLinks.regex;
    template.input.value = this.data.issueLinks.urlTemplate;
    regex.input.addEventListener("input", () => this.clearFieldError(regex.input, regex.error));
    template.input.addEventListener("input", () =>
      this.clearFieldError(template.input, template.error)
    );

    section.append(title, form);
    return section;
  }

  private createComingSoonSection(id: string, label: string, description: string): HTMLElement {
    const section = document.createElement("section");
    section.className = "repo-settings-section";
    section.setAttribute("aria-labelledby", id);

    const title = document.createElement("h3");
    title.id = id;
    title.textContent = label;
    const message = document.createElement("p");
    message.className = "repo-settings-coming-soon";
    message.textContent = description;

    section.append(title, message);
    return section;
  }

  private createTextField(
    labelText: string,
    kind: string
  ): {
    error: HTMLElement;
    input: HTMLInputElement;
    label: HTMLLabelElement;
  } {
    const id = `${this.idPrefix}-${kind}`;
    const input = document.createElement("input");
    input.type = "text";
    input.id = id;
    input.name = id;
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = labelText;
    const error = document.createElement("p");
    error.id = `${id}-error`;
    error.className = "repo-settings-error";
    return { error, input, label };
  }

  private createFormField(
    label: HTMLLabelElement,
    input: HTMLInputElement,
    error: HTMLElement
  ): HTMLElement {
    const field = document.createElement("div");
    field.className = "repo-settings-field";
    field.append(label, input, error);
    return field;
  }

  private createButton(
    labelText: string,
    accessibleName: string,
    onClick: () => void,
    style: "primary" | "secondary"
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = accessibleName;
    if (accessibleName !== labelText) {
      button.setAttribute("aria-label", labelText);
    }
    button.addEventListener("click", onClick);
    if (style === "secondary") {
      button.classList.add("repo-settings-secondary-button");
    }
    return button;
  }

  private startEdit(remote: RepoSettingsRemote): void {
    this.editingRemoteName = remote.name;
    this.fields.remoteName.value = remote.name;
    this.fields.remoteUrl.value = remote.url;
    this.fields.remotePushUrl.value = remote.pushUrl ?? "";
    this.fields.remoteTitle.textContent = `Edit remote ${remote.name}`;
    this.fields.submitRemote.textContent = "Save remote";
    this.remoteCancelButton.hidden = false;
    this.clearFieldError(this.fields.remoteName, this.fields.remoteNameError);
    this.clearFieldError(this.fields.remoteUrl, this.fields.remoteUrlError);
    this.fields.remoteName.focus();
  }

  private cancelEdit(): void {
    this.editingRemoteName = null;
    this.resetRemoteForm();
  }

  private submitRemote(): void {
    const name = this.fields.remoteName.value.trim();
    const url = this.fields.remoteUrl.value.trim();
    const pushUrl = this.fields.remotePushUrl.value.trim();
    const nameErrors = this.validateRemoteName(name);
    const urlErrors = this.validateRemoteUrl(url);
    this.setFieldErrors(this.fields.remoteName, this.fields.remoteNameError, nameErrors);
    this.setFieldErrors(this.fields.remoteUrl, this.fields.remoteUrlError, urlErrors);
    if (nameErrors.length > 0 || urlErrors.length > 0) {
      return;
    }

    const normalizedRemote: RepoSettingsRemote =
      pushUrl === "" || pushUrl === url ? { name, url } : { name, url, pushUrl };
    if (this.editingRemoteName === null) {
      this.actionHandler({ type: "addRemote", ...normalizedRemote });
    } else {
      this.actionHandler({
        type: "editRemote",
        originalName: this.editingRemoteName,
        ...normalizedRemote
      });
    }
    this.resetRemoteForm();
  }

  private submitIssueLinks(): void {
    const enabled = this.fields.issueEnabled.checked;
    const regex = this.fields.issueRegex.value.trim();
    const urlTemplate = this.fields.issueTemplate.value.trim();
    const regexErrors = enabled ? this.validateIssueRegex(regex) : [];
    const templateErrors = enabled ? this.validateIssueUrlTemplate(urlTemplate) : [];
    this.setFieldErrors(this.fields.issueRegex, this.fields.issueRegexError, regexErrors);
    this.setFieldErrors(this.fields.issueTemplate, this.fields.issueTemplateError, templateErrors);
    if (regexErrors.length > 0 || templateErrors.length > 0) {
      return;
    }
    this.actionHandler({ type: "saveIssueLinks", settings: { enabled, regex, urlTemplate } });
  }

  private validateRemoteName(name: string): string[] {
    if (name === "") {
      return ["Remote name is required."];
    }
    if (!REMOTE_NAME_PATTERN.test(name)) {
      return ["Use letters, numbers, dots, and internal hyphens; start with a letter or number."];
    }
    const duplicate = this.data.remotes.some(
      (remote) => remote.name === name && remote.name !== this.editingRemoteName
    );
    if (duplicate) {
      return ["A remote with this name already exists."];
    }
    return [];
  }

  private validateRemoteUrl(url: string): string[] {
    if (url === "") {
      return ["URL is required."];
    }
    if (!this.isValidRemoteUrl(url)) {
      return ["Enter a valid HTTP(S), SSH, Git, or scp-like remote URL."];
    }
    return [];
  }

  private isValidRemoteUrl(url: string): boolean {
    if (/\s|\p{Cc}|\u{7f}/u.test(url)) {
      return false;
    }
    if (!REMOTE_URL_PROTOCOL_PATTERN.test(url)) {
      return REMOTE_URL_SCP_PATTERN.test(url);
    }
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.hostname.length > 0 || url.startsWith("file://");
    } catch {
      return false;
    }
  }

  private validateIssueRegex(regex: string): string[] {
    if (regex === "") {
      return ["Issue regex is required when issue links are enabled."];
    }
    try {
      new RegExp(regex, "u");
      return [];
    } catch (error) {
      return [error instanceof Error ? `Invalid regex: ${error.message}` : "Invalid regex."];
    }
  }

  private validateIssueUrlTemplate(urlTemplate: string): string[] {
    if (urlTemplate === "") {
      return ["Issue URL template is required when issue links are enabled."];
    }
    const hasCapturePlaceholder = [...CAPTURE_PLACEHOLDERS].some((placeholder) =>
      urlTemplate.includes(placeholder)
    );
    if (!hasCapturePlaceholder) {
      return ["Include the {0} capture placeholder in the URL template."];
    }
    return [];
  }

  private resetRemoteForm(): void {
    this.editingRemoteName = null;
    this.fields.remoteName.value = "";
    this.fields.remoteUrl.value = "";
    this.fields.remotePushUrl.value = "";
    this.fields.remoteTitle.textContent = "Add a remote";
    this.fields.submitRemote.textContent = "Add remote";
    this.remoteCancelButton.hidden = true;
    this.clearFieldError(this.fields.remoteName, this.fields.remoteNameError);
    this.clearFieldError(this.fields.remoteUrl, this.fields.remoteUrlError);
  }

  private setFieldErrors(
    input: HTMLInputElement,
    errorElement: HTMLElement,
    messages: string[]
  ): void {
    const message = messages.join(" ");
    errorElement.textContent = message;
    if (message === "") {
      this.clearFieldError(input, errorElement);
      return;
    }
    input.classList.add("invalid");
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", errorElement.id);
  }

  private clearFieldError(input: HTMLInputElement, errorElement: HTMLElement): void {
    errorElement.textContent = "";
    input.classList.remove("invalid");
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
  }
}

export function openRepoSettings(
  container: HTMLElement,
  data: RepoSettingsData,
  actionHandler: RepoSettingsActionHandler
): RepoSettingsPanel {
  const panel = new RepoSettingsPanel(container, data, actionHandler);
  panel.open();
  return panel;
}
