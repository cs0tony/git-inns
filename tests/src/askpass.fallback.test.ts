import type * as net from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({ window: { showInputBox: vi.fn() } }));

import { AskpassManager } from "../../src/askpass/manager";

describe("Askpass endpoint fallback", () => {
  let manager: AskpassManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AskpassManager();
  });

  afterEach(async () => {
    await manager.stop();
  });

  it("falls back to the empty entrypoint when the endpoint cannot listen", async () => {
    let emitServerError: (() => void) | undefined;
    manager = new AskpassManager(() => {
      const server = {
        close: (callback: () => void) => callback(),
        listen: (_endpoint: string, callback?: () => void) => {
          emitServerError?.();
          callback?.();
        },
        on: (_event: string, handler: (error: Error) => void) => {
          emitServerError = () => handler(new Error("endpoint unavailable"));
        }
      };
      return server as unknown as net.Server;
    });
    await manager.start();

    expect(manager.isReady()).toBe(false);
    expect(manager.getEnvironment()).toMatchObject({
      ELECTRON_RUN_AS_NODE: "1",
      GIT_TERMINAL_PROMPT: "0",
      GIT_KEIZU_NODE: process.execPath,
      SSH_ASKPASS_REQUIRE: "force"
    });
    const environment = manager.getEnvironment();
    expect(environment.GIT_ASKPASS).toBeDefined();
    expect(environment.GIT_ASKPASS).not.toBe("");
  });

  it("uses the inherited environment before the endpoint starts", () => {
    expect(manager.isReady()).toBe(false);
    expect(manager.getEnvironment()).toEqual(process.env);
  });
});
