/**
 * Runtime entrypoint generators for Git's Askpass helpers.
 *
 * The scripts are generated into a private temporary directory because packaged
 * extensions contain a single bundled JavaScript file and cannot rely on
 * source-tree assets being copied to the output directory.
 */

export const ASKPASS_ENTRYPOINT_NAME = "askpass";
export const EMPTY_ASKPASS_ENTRYPOINT_NAME = "empty-askpass";
export const WINDOWS_ASKPASS_ENTRYPOINT_NAME = "askpass.cmd";
export const WINDOWS_EMPTY_ASKPASS_ENTRYPOINT_NAME = "empty-askpass.cmd";

export function createAskpassEntrypoint(endpoint: string, nonce: string): string {
  return `#!/usr/bin/env node
"use strict";

const http = require("node:http");

const endpoint = ${JSON.stringify(endpoint)};
const nonce = ${JSON.stringify(nonce)};
const prompt = process.argv[2];

if (typeof prompt !== "string" || prompt === "") {
  process.exitCode = 1;
} else {
  const requestBody = JSON.stringify({ prompt });
  const requestBodyLength = Buffer.byteLength(requestBody);
  const responseChunks = [];
  const httpRequest = http.request({
    socketPath: endpoint,
    path: "/",
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": requestBodyLength,
      "x-git-keizu-askpass-nonce": nonce
    }
  }, (response) => {
    response.setEncoding("utf8");
    response.on("data", (chunk) => responseChunks.push(chunk));
    response.on("end", () => {
      if (response.statusCode !== 200) {
        process.exitCode = 1;
        return;
      }
      process.stdout.write(responseChunks.join(""));
    });
  });
  httpRequest.on("error", () => {
    process.exitCode = 1;
  });
  httpRequest.end(requestBody);
}
`;
}

export function createEmptyAskpassEntrypoint(): string {
  return `#!/usr/bin/env node
"use strict";
`;
}

export function createWindowsAskpassEntrypoint(entrypointName: string): string {
  return `@echo off
"node" "%~dp0${entrypointName}" %*
`;
}
