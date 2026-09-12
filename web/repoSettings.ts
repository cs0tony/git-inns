import { isSafePullRequestBranch } from "../src/pullRequest";
import type {
  PullRequestProviderKind,
  RepositorySettingsAction,
  RepositorySettingsData,
  RepositorySettingsIssueLinks,
  RepositorySettingsRemote,
  RepositorySettingsUserScope,
  RepositoryVisibility
} from "../src/types";
import { t } from "./i18n";

export type RepoSettingsRemote = RepositorySettingsRemote;
export type RepoSettingsIssueLinks = RepositorySettingsIssueLinks;
export type RepoSettingsData = RepositorySettingsData;
export type RepoSettingsAction = RepositorySettingsAction;

export type RepoSettingsActionHandler = (action: RepoSettingsAction) => void;

export interface RepoSettingsConfigHandlers {
  onExportConfig(): void;
  onImportConfig(): void;
}

interface SettingsFields {
  issueEnabled: HTMLInputElement;
  issueRegex: HTMLInputElement;
  issueRegexError: HTMLElement;
  issueTemplate: HTMLInputElement;
  issueTemplateError: HTMLElement;
  pullCustomName: HTMLInputElement;
  pullCustomNameError: HTMLElement;
  pullCustomTemplate: HTMLInputElement;
  pullCustomTemplateError: HTMLElement;
  pullDestination: HTMLSelectElement;
  pullDestinationError: HTMLElement;
  pullDestinationHint: HTMLElement;
  pullProvider: HTMLSelectElement;
  pullRemote: HTMLSelectElement;
  remoteName: HTMLInputElement;
  remoteNameError: HTMLElement;
  remotePushUrl: HTMLInputElement;
  remoteTitle: HTMLElement;
  remoteUrl: HTMLInputElement;
  remoteUrlError: HTMLElement;
  submitRemote: HTMLButtonElement;
  userEmail: HTMLInputElement;
  userEmailError: HTMLElement;
  userEmailSource: HTMLElement;
  userName: HTMLInputElement;
  userNameError: HTMLElement;
  userNameSource: HTMLElement;
  userScope: HTMLSelectElement;
  userScopeError: HTMLElement;
}

const REMOTE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]*$/u;
const REMOTE_URL_PROTOCOL_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u;
const REMOTE_URL_SCP_PATTERN = /^[^@/\s]+@[^:\s]+:[^\s]+$/u;
const CAPTURE_PLACEHOLDERS = new Set(["{0}", "{issue}"]);

export class RepoSettingsPanel {
  private readonly actionHandler: RepoSettingsActionHandler;
  private readonly configHandlers: RepoSettingsConfigHandlers | null;
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
    actionHandler: RepoSettingsActionHandler,
    configHandlers?: RepoSettingsConfigHandlers
  ) {
    this.container = container;
    this.data = data;
    this.actionHandler = actionHandler;
    this.configHandlers = configHandlers ?? null;
    this.idPrefix = `repo-settings-${document.querySelectorAll(".repo-settings").length + 1}`;
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
      t("repoSettings.closeAria"),
      t("repoSettings.close"),
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
      this.createUserDetailsSection(),
      this.createVisibilitySection(),
      this.createRemotesSection(),
      this.createIssueLinkSection(),
      this.createPullRequestSection(),
      this.createRepositoryConfigSection()
    );

    this.root.replaceChildren(header, main);
  }

  private createUserDetailsSection(): HTMLElement {
    const section = document.createElement("section");
    section.className = "repo-settings-section";
    section.setAttribute("aria-labelledby", `${this.idPrefix}-user-title`);

    const title = document.createElement("h3");
    title.id = `${this.idPrefix}-user-title`;
    title.textContent = t("repoSettings.userDetails");
    const description = document.createElement("p");
    description.className = "repo-settings-section-description";
    description.textContent = t("repoSettings.userDetailsHelp");

    const form = document.createElement("form");
    form.className = "repo-settings-form";
    form.setAttribute("aria-labelledby", `${this.idPrefix}-user-title`);
    form.noValidate = true;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitUserDetails();
    });

    const name = this.createTextField(t("repoSettings.userName"), "user-name");
    const email = this.createTextField(t("repoSettings.userEmail"), "user-email");
    name.input.value = this.data.user.name.effectiveValue ?? "";
    email.input.value = this.data.user.email.effectiveValue ?? "";

    const scopeId = `${this.idPrefix}-user-scope`;
    const scope = document.createElement("select");
    scope.id = scopeId;
    scope.name = scopeId;
    for (const item of ["local", "global"] as const) {
      const option = document.createElement("option");
      option.value = item;
      option.textContent = t(
        item === "local"
          ? "repoSettings.userScopeLocal"
          : "repoSettings.userScopeGlobal"
      );
      scope.append(option);
    }
    const scopeLabel = document.createElement("label");
    scopeLabel.htmlFor = scopeId;
    scopeLabel.textContent = t("repoSettings.userScope");
    const scopeError = document.createElement("p");
    scopeError.id = `${scopeId}-error`;
    scopeError.className = "repo-settings-error";
    scope.setAttribute("aria-describedby", scopeError.id);
    scope.dataset.describedBy = scopeError.id;

    const nameSource = document.createElement("p");
    nameSource.className = "repo-settings-hint";
    nameSource.dataset.testid = "user-name-source";
    nameSource.textContent = this.createUserSourceText(this.data.user.name);
    const emailSource = document.createElement("p");
    emailSource.className = "repo-settings-hint";
    emailSource.dataset.testid = "user-email-source";
    emailSource.textContent = this.createUserSourceText(this.data.user.email);

    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = t("repoSettings.saveUserDetails");
    const remove = this.createButton(
      t("repoSettings.removeUserDetailsAria"),
      t("repoSettings.removeUserDetails"),
      () => this.removeUserDetails(),
      "secondary"
    );
    const actions = document.createElement("div");
    actions.className = "repo-settings-form-actions";
    actions.append(save, remove);

    form.append(
      this.createFormField(name.label, name.input, name.error, nameSource),
      this.createFormField(email.label, email.input, email.error, emailSource),
      this.createFormField(scopeLabel, scope, scopeError),
      actions
    );

    this.fields.userName = name.input;
    this.fields.userNameError = name.error;
    this.fields.userNameSource = nameSource;
    this.fields.userEmail = email.input;
    this.fields.userEmailError = email.error;
    this.fields.userEmailSource = emailSource;
    this.fields.userScope = scope;
    this.fields.userScopeError = scopeError;
    name.input.addEventListener("input", () =>
      this.clearFieldError(name.input, name.error)
    );
    email.input.addEventListener("input", () =>
      this.clearFieldError(email.input, email.error)
    );

    section.append(title, description, form);
    return section;
  }

  private createUserSourceText(userValue: {
    effectiveValue: string | null;
    source: RepositorySettingsUserScope | null;
  }): string {
    if (userValue.effectiveValue === null || userValue.source === null) {
      return t("repoSettings.userValueNotSet");
    }
    return userValue.source === "local"
      ? t("repoSettings.userValueLocal", userValue.effectiveValue)
      : t("repoSettings.userValueGlobal", userValue.effectiveValue);
  }

  private createVisibilitySection(): HTMLElement {
    const section = document.createElement("section");
    section.className = "repo-settings-section";
    section.setAttribute("aria-labelledby", `${this.idPrefix}-visibility-title`);

    const title = document.createElement("h3");
    title.id = `${this.idPrefix}-visibility-title`;
    title.textContent = t("repoSettings.visibility");

    const description = document.createElement("p");
    description.className = "repo-settings-section-description";
    description.textContent = t("repoSettings.visibilityDescription");

    const form = document.createElement("form");
    form.className = "repo-settings-visibility-form";
    const labels: Record<keyof RepositoryVisibility, string> = {
      showTags: t("repoSettings.showTags"),
      showStashes: t("repoSettings.showStashes"),
      showRemoteHeads: t("repoSettings.showRemoteHeads"),
      showUntrackedFiles: t("repoSettings.showUntrackedFiles")
    };
    const visibilityKeys = Object.keys(labels) as (keyof RepositoryVisibility)[];

    for (const key of visibilityKeys) {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("role", "switch");
      input.id = `${this.idPrefix}-visibility-${String(key)}`;
      input.checked = this.data.visibility[key];
      input.addEventListener("change", () => {
        this.actionHandler({
          type: "saveVisibility",
          settings: { ...this.data.visibility, [key]: input.checked }
        });
      });

      const label = document.createElement("label");
      label.className = "repo-settings-checkbox";
      label.htmlFor = input.id;
      label.append(input, document.createTextNode(labels[key]));
      form.append(label);
    }

    section.append(title, description, form);
    return section;
  }

  private createTitle(): HTMLElement {
    const title = document.createElement("h2");
    title.id = `${this.idPrefix}-title`;
    title.textContent = t("repoSettings.title", this.data.repositoryName);
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
    title.textContent = t("repoSettings.remotes");

    section.append(title, this.createRemoteList(), this.createRemoteForm());
    return section;
  }

  private createRemoteList(): HTMLElement {
    const list = document.createElement("ul");
    list.className = "repo-settings-remote-list";
    list.setAttribute("aria-label", t("repoSettings.configuredRemotes"));

    if (this.data.remotes.length === 0) {
      const emptyItem = document.createElement("li");
      emptyItem.className = "repo-settings-empty";
      emptyItem.textContent = t("repoSettings.noRemotes");
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
        t("repoSettings.editRemoteAria", remote.name),
        t("repoSettings.edit"),
        () => this.startEdit(remote),
        "secondary"
      ),
      this.createButton(
        t("repoSettings.deleteRemoteAria", remote.name),
        t("repoSettings.delete"),
        () => {
          this.actionHandler({ type: "deleteRemote", name: remote.name });
        },
        "secondary"
      ),
      this.createButton(
        t("repoSettings.fetchRemoteAria", remote.name),
        t("repoSettings.fetch"),
        () => {
          this.actionHandler({ type: "fetchRemote", name: remote.name });
        },
        "secondary"
      ),
      this.createButton(
        t("repoSettings.fetchPruneRemoteAria", remote.name),
        t("repoSettings.fetchPrune"),
        () => {
          this.actionHandler({ type: "fetchPruneRemote", name: remote.name });
        },
        "secondary"
      ),
      this.createButton(
        t("repoSettings.pruneTagsRemoteAria", remote.name),
        t("repoSettings.pruneTags"),
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
    title.textContent = t("repoSettings.addRemote");

    const name = this.createTextField(t("repoSettings.remoteName"), "remote-name");
    const url = this.createTextField(t("repoSettings.remoteUrl"), "remote-url");
    const pushUrl = this.createTextField(t("repoSettings.remotePushUrl"), "remote-push-url");
    pushUrl.input.placeholder = t("repoSettings.remotePushUrlPlaceholder");

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = t("repoSettings.addRemote");

    const cancel = this.createButton(
      t("repoSettings.cancelRemoteEdit"),
      t("repoSettings.cancel"),
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
    title.textContent = t("repoSettings.issueLinks");

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
    enabledLabel.append(enabled, document.createTextNode(t("repoSettings.linkIssueReferences")));

    const regex = this.createTextField(t("repoSettings.issueRegex"), "issue-regex");
    const template = this.createTextField(t("repoSettings.issueUrlTemplate"), "issue-template");
    template.input.placeholder = t("repoSettings.issueUrlTemplatePlaceholder", "{0}");

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = t("repoSettings.saveIssueLinks");

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

  private createPullRequestSection(): HTMLElement {
    const section = document.createElement("section");
    section.className = "repo-settings-section";
    section.setAttribute("aria-labelledby", `${this.idPrefix}-pull-title`);

    const title = document.createElement("h3");
    title.id = `${this.idPrefix}-pull-title`;
    title.textContent = t("repoSettings.pullProviders");
    const description = document.createElement("p");
    description.className = "repo-settings-section-description";
    description.textContent = t("repoSettings.pullProvidersHelp");

    const form = document.createElement("form");
    form.className = "repo-settings-form";
    form.noValidate = true;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitPullRequest();
    });

    const providerId = `${this.idPrefix}-pull-provider`;
    const provider = document.createElement("select");
    provider.id = providerId;
    provider.name = providerId;
    for (const providerKind of ["github", "gitlab", "bitbucket", "custom"] as const) {
      const option = document.createElement("option");
      option.value = providerKind;
      option.textContent = t(`repoSettings.provider.${providerKind}`);
      provider.append(option);
    }
    provider.value = this.data.pullRequest?.provider ?? "github";
    const providerLabel = document.createElement("label");
    providerLabel.htmlFor = providerId;
    providerLabel.textContent = t("repoSettings.pullProvider");

    const remoteId = `${this.idPrefix}-pull-remote`;
    const remote = document.createElement("select");
    remote.id = remoteId;
    remote.name = remoteId;
    for (const item of this.data.remotes) {
      const option = document.createElement("option");
      option.value = item.name;
      option.textContent = item.name;
      remote.append(option);
    }
    remote.value = this.data.pullRequest?.sourceRemoteName ?? this.data.remotes[0]?.name ?? "";
    const remoteLabel = document.createElement("label");
    remoteLabel.htmlFor = remoteId;
    remoteLabel.textContent = t("repoSettings.pullSourceRemote");

    const destinationId = `${this.idPrefix}-pull-destination`;
    const destination = document.createElement("select");
    destination.id = destinationId;
    destination.name = destinationId;
    const branches = this.data.pullRequestDestination?.branches ?? [];
    const defaultBranch = this.data.pullRequestDestination?.defaultBranch ?? null;
    for (const branch of branches) {
      const option = document.createElement("option");
      option.value = branch;
      option.textContent =
        branch === defaultBranch
          ? `${branch} (${t("repoSettings.pullDestinationDefaultOption")})`
          : branch;
      destination.append(option);
    }
    const selectedBranch = this.data.pullRequestDestination?.selectedBranch;
    destination.value =
      typeof selectedBranch === "string" && branches.includes(selectedBranch)
        ? selectedBranch
        : (branches[0] ?? "");
    const destinationLabel = document.createElement("label");
    destinationLabel.htmlFor = destinationId;
    destinationLabel.textContent = t("repoSettings.pullDestination");
    const destinationHint = document.createElement("p");
    destinationHint.id = `${destinationId}-hint`;
    destinationHint.className = "repo-settings-hint";
    destinationHint.textContent =
      defaultBranch === null ? "" : t("repoSettings.pullDestinationDefaultHint", defaultBranch);
    const destinationError = document.createElement("p");
    destinationError.id = `${destinationId}-error`;
    destinationError.className = "repo-settings-error";
    destination.setAttribute("aria-describedby", `${destinationHint.id} ${destinationError.id}`);
    destination.dataset.describedBy = `${destinationHint.id} ${destinationError.id}`;

    const custom = this.createTextField(t("repoSettings.pullCustomName"), "pull-custom-name");
    custom.input.value = this.data.pullRequest?.customName ?? "";
    const template = this.createTextField(
      t("repoSettings.pullCustomTemplate"),
      "pull-custom-template"
    );
    template.input.value = this.data.pullRequest?.customTemplateUrl ?? "";
    template.input.placeholder = "https://example.com/{sourceBranch}";

    const submit = this.createButton(
      t("repoSettings.savePullRequest"),
      t("repoSettings.savePullRequest"),
      () => this.submitPullRequest(),
      "primary"
    );
    form.append(
      this.createFormField(providerLabel, provider, custom.error),
      this.createFormField(remoteLabel, remote, custom.error),
      this.createFormField(destinationLabel, destination, destinationError, destinationHint),
      this.createFormField(custom.label, custom.input, custom.error),
      this.createFormField(template.label, template.input, template.error),
      submit
    );

    this.fields.pullProvider = provider;
    this.fields.pullRemote = remote;
    this.fields.pullDestination = destination;
    this.fields.pullDestinationError = destinationError;
    this.fields.pullDestinationHint = destinationHint;
    this.fields.pullCustomName = custom.input;
    this.fields.pullCustomNameError = custom.error;
    this.fields.pullCustomTemplate = template.input;
    this.fields.pullCustomTemplateError = template.error;

    section.append(title, description, form);
    return section;
  }

  private submitPullRequest(): void {
    const provider = this.fields.pullProvider.value as PullRequestProviderKind;
    const remoteName = this.fields.pullRemote.value;
    const destinationBranch = this.fields.pullDestination.value;
    const customName = this.fields.pullCustomName.value.trim();
    const customTemplateUrl = this.fields.pullCustomTemplate.value.trim();
    const customErrors =
      provider === "custom" && customTemplateUrl === ""
        ? [t("repoSettings.pullCustomTemplateRequired")]
        : [];
    const remoteErrors = remoteName === "" ? [t("repoSettings.pullRemoteRequired")] : [];
    const destinationErrors =
      this.data.pullRequestDestination?.branches.includes(destinationBranch) &&
      isSafePullRequestBranch(destinationBranch)
        ? []
        : [t("repoSettings.pullDestinationInvalid")];
    this.setFieldErrors(
      this.fields.pullCustomTemplate,
      this.fields.pullCustomTemplateError,
      customErrors
    );
    this.setFieldErrors(this.fields.pullRemote, this.fields.pullCustomNameError, remoteErrors);
    this.setFieldErrors(
      this.fields.pullDestination,
      this.fields.pullDestinationError,
      destinationErrors
    );
    if (customErrors.length > 0 || remoteErrors.length > 0 || destinationErrors.length > 0) {
      return;
    }

    this.actionHandler({
      type: "savePullRequest",
      settings: {
        provider,
        remoteName,
        destinationBranch,
        ...(provider === "custom"
          ? {
              customName: customName === "" ? undefined : customName,
              customTemplateUrl
            }
          : {})
      }
    });
  }

  private createRepositoryConfigSection(): HTMLElement {
    const section = document.createElement("section");
    section.className = "repo-settings-section";
    section.setAttribute("aria-labelledby", `${this.idPrefix}-config-title`);

    const title = document.createElement("h3");
    title.id = `${this.idPrefix}-config-title`;
    title.textContent = t("repoSettings.export");
    const description = document.createElement("p");
    description.className = "repo-settings-section-description";
    description.textContent = t("repoSettings.exportHelp");

    const actions = document.createElement("div");
    actions.className = "repo-settings-actions";
    const exportButton = this.createButton(
      t("repoSettings.exportButtonAria"),
      t("repoSettings.exportButtonShort"),
      () => this.configHandlers?.onExportConfig(),
      "primary"
    );
    const importButton = this.createButton(
      t("repoSettings.importButtonAria"),
      t("repoSettings.importButtonShort"),
      () => this.configHandlers?.onImportConfig(),
      "secondary"
    );
    actions.append(exportButton, importButton);
    section.append(title, description, actions);
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
    input: HTMLInputElement | HTMLSelectElement,
    error: HTMLElement,
    hint?: HTMLElement
  ): HTMLElement {
    const field = document.createElement("div");
    field.className = "repo-settings-field";
    field.append(label, input, ...(hint === undefined ? [] : [hint]), error);
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
    this.fields.remoteTitle.textContent = t("repoSettings.editRemote", remote.name);
    this.fields.submitRemote.textContent = t("repoSettings.saveRemote");
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
        name,
        url,
        // Clearing the edit field is an explicit request to reset push to the
        // fetch URL; the empty string itself is not a valid Git URL.
        pushUrl: pushUrl === "" ? url : pushUrl
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

  private submitUserDetails(): void {
    const scope = this.fields.userScope.value as RepositorySettingsUserScope;
    const name = this.fields.userName.value.trim();
    const email = this.fields.userEmail.value.trim();
    const nameErrors = this.validateUserDetail(name);
    const emailErrors = this.validateUserDetail(email);
    this.setFieldErrors(this.fields.userName, this.fields.userNameError, nameErrors);
    this.setFieldErrors(this.fields.userEmail, this.fields.userEmailError, emailErrors);
    if (nameErrors.length > 0 || emailErrors.length > 0) {
      return;
    }
    this.actionHandler({ type: "saveUserDetails", scope, name, email });
  }

  private removeUserDetails(): void {
    const scope = this.fields.userScope.value as RepositorySettingsUserScope;
    const confirmed = window.confirm(
      t(
        scope === "local"
          ? "repoSettings.removeUserDetailsLocalConfirm"
          : "repoSettings.removeUserDetailsGlobalConfirm"
      )
    );
    if (!confirmed) return;
    this.actionHandler({ type: "removeUserDetails", scope });
  }

  private validateUserDetail(value: string): string[] {
    if (value === "") {
      return [t("repoSettings.userDetailsRequired")];
    }
    if (/\p{Cc}/u.test(value)) {
      return [t("repoSettings.userDetailsControlCharacters")];
    }
    return [];
  }

  private validateRemoteName(name: string): string[] {
    if (name === "") {
      return [t("repoSettings.remoteNameRequired")];
    }
    if (!REMOTE_NAME_PATTERN.test(name)) {
      return [t("repoSettings.remoteNameInvalid")];
    }
    const duplicate = this.data.remotes.some(
      (remote) => remote.name === name && remote.name !== this.editingRemoteName
    );
    if (duplicate) {
      return [t("repoSettings.remoteNameDuplicate")];
    }
    return [];
  }

  private validateRemoteUrl(url: string): string[] {
    if (url === "") {
      return [t("repoSettings.remoteUrlRequired")];
    }
    if (!this.isValidRemoteUrl(url)) {
      return [t("repoSettings.remoteUrlInvalid")];
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
      return [t("repoSettings.issueRegexRequired")];
    }
    try {
      new RegExp(regex, "u");
      return [];
    } catch (error) {
      return [
        error instanceof Error
          ? t("repoSettings.issueRegexInvalid", error.message)
          : t("repoSettings.issueRegexInvalidFallback")
      ];
    }
  }

  private validateIssueUrlTemplate(urlTemplate: string): string[] {
    if (urlTemplate === "") {
      return [t("repoSettings.issueTemplateRequired")];
    }
    const hasCapturePlaceholder = [...CAPTURE_PLACEHOLDERS].some((placeholder) =>
      urlTemplate.includes(placeholder)
    );
    if (!hasCapturePlaceholder) {
      return [t("repoSettings.issueTemplateCapture", "{0}")];
    }
    return [];
  }

  private resetRemoteForm(): void {
    this.editingRemoteName = null;
    this.fields.remoteName.value = "";
    this.fields.remoteUrl.value = "";
    this.fields.remotePushUrl.value = "";
    this.fields.remoteTitle.textContent = t("repoSettings.addRemote");
    this.fields.submitRemote.textContent = t("repoSettings.addRemote");
    this.remoteCancelButton.hidden = true;
    this.clearFieldError(this.fields.remoteName, this.fields.remoteNameError);
    this.clearFieldError(this.fields.remoteUrl, this.fields.remoteUrlError);
  }

  private setFieldErrors(
    input: HTMLInputElement | HTMLSelectElement,
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

  private clearFieldError(
    input: HTMLInputElement | HTMLSelectElement,
    errorElement: HTMLElement
  ): void {
    errorElement.textContent = "";
    input.classList.remove("invalid");
    input.removeAttribute("aria-invalid");
    if (input.dataset.describedBy === undefined) {
      input.removeAttribute("aria-describedby");
    } else {
      input.setAttribute("aria-describedby", input.dataset.describedBy);
    }
  }
}

export function openRepoSettings(
  container: HTMLElement,
  data: RepoSettingsData,
  actionHandler: RepoSettingsActionHandler,
  configHandlers?: RepoSettingsConfigHandlers
): RepoSettingsPanel {
  const panel = new RepoSettingsPanel(container, data, actionHandler, configHandlers);
  panel.open();
  return panel;
}
