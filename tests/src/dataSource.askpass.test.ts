import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn()
    }))
  }
}));

vi.mock("../../src/config", () => ({
  getConfig: vi.fn(() => ({
    dateType: () => "Author Date",
    gitPath: () => ["/configured/git"],
    showSignatureStatus: () => false,
    useMailmap: () => false
  }))
}));

const resolveGitExecutableMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/gitExecutable", () => ({
  DEFAULT_GIT_PATH: "git",
  resolveGitExecutable: resolveGitExecutableMock
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn()
}));

import * as cp from "node:child_process";

import { type AskpassManagerLike } from "../../src/askpass/manager";
import { DataSource } from "../../src/dataSource";

const REPO = "/test/repo";

class StubAskpassManager implements AskpassManagerLike {
  public startCalls = 0;
  public stopCalls = 0;
  public environment: NodeJS.ProcessEnv = { ...process.env };

  public async start(): Promise<void> {
    this.startCalls += 1;
    this.environment = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      GIT_ASKPASS: "/runtime/askpass",
      GIT_KEIZU_NODE: process.execPath,
      GIT_TERMINAL_PROMPT: "0",
      SSH_ASKPASS: "/runtime/askpass",
      SSH_ASKPASS_REQUIRE: "force"
    };
  }

  public async stop(): Promise<void> {
    this.stopCalls += 1;
  }

  public getEnvironment(): NodeJS.ProcessEnv {
    return this.environment;
  }

  public isReady(): boolean {
    return this.startCalls > this.stopCalls;
  }
}

function createSuccessfulProcess() {
  const gitProcess = new EventEmitter();
  Object.assign(gitProcess, {
    stdout: new EventEmitter(),
    stderr: new EventEmitter()
  });
  queueMicrotask(() => {
    gitProcess.emit("close", 0);
  });
  return gitProcess as unknown as cp.ChildProcess;
}

describe("DataSource Askpass integration", () => {
  const spawnMock = vi.mocked(cp.spawn);

  beforeEach(() => {
    vi.clearAllMocks();
    resolveGitExecutableMock.mockResolvedValue("/resolved/git");
    spawnMock.mockImplementation(() => createSuccessfulProcess());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("injects the Askpass environment into every Git subprocess after startup", async () => {
    const askpass = new StubAskpassManager();
    const dataSource = new DataSource(undefined, askpass);

    await dataSource.registerGitPath();
    await dataSource.isGitRepository(REPO);

    expect(askpass.startCalls).toBe(1);
    expect(cp.spawn).toHaveBeenCalledWith("/resolved/git", ["rev-parse", "--git-dir"], {
      cwd: REPO,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        GIT_ASKPASS: "/runtime/askpass",
        GIT_KEIZU_NODE: process.execPath,
        GIT_TERMINAL_PROMPT: "0",
        SSH_ASKPASS: "/runtime/askpass",
        SSH_ASKPASS_REQUIRE: "force",
        LC_ALL: "C"
      }
    });
    dataSource.dispose();
    expect(askpass.stopCalls).toBe(1);
  });

  it("keeps the inherited environment when an injected manager has not started", async () => {
    const askpass = new StubAskpassManager();
    const dataSource = new DataSource(undefined, askpass);

    await dataSource.isGitRepository(REPO);

    expect(askpass.startCalls).toBe(0);
    expect(cp.spawn).toHaveBeenCalledWith("git", ["rev-parse", "--git-dir"], {
      cwd: REPO,
      env: { ...process.env, LC_ALL: "C" }
    });
  });
});
