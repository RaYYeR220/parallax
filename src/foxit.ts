/**
 * A minimal Foxit PDF Services client.
 *
 * Two things matter more here than in a general client. The developer plan has
 * 500 credits a year, so every completed operation is cached on disk by the
 * hash of its input and its parameters, and a rerun of the pipeline spends
 * nothing. And the gateway allows roughly fifteen requests a minute, so every
 * request — polls included — goes through one limiter.
 */

import { createHash } from "node:crypto";
import dns from "node:dns";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

// The gateway publishes IPv6 addresses this network times out on.
dns.setDefaultResultOrder("ipv4first");

const HOST = process.env.FOXIT_HOST ?? "https://na1.fusion.foxit.com";
const BASE = `${HOST}/pdf-services`;
const CACHE_DIR = path.resolve(".cache/foxit");

const REQUESTS_PER_MINUTE = 14;
const recent: number[] = [];

async function throttle(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (recent.length > 0 && now - recent[0] > 60_000) recent.shift();
    if (recent.length < REQUESTS_PER_MINUTE) {
      recent.push(now);
      return;
    }
    await sleep(60_000 - (now - recent[0]) + 50);
  }
}

function credentials(): Record<string, string> {
  const id = process.env.FOXIT_CLIENT_ID;
  const secret = process.env.FOXIT_CLIENT_SECRET;
  if (!id || !secret) throw new Error("FOXIT_CLIENT_ID and FOXIT_CLIENT_SECRET must be set");
  return { client_id: id, client_secret: secret };
}

async function call(route: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
  await throttle();
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(credentials())) headers.set(k, v);
  let response: Response;
  try {
    response = await fetch(`${BASE}${route}`, { ...init, headers });
  } catch (error) {
    // A reset connection is the network, not the request; try again a few times.
    if (attempt >= 6) throw error;
    await sleep(3_000 * (attempt + 1));
    return call(route, init, attempt + 1);
  }
  if (response.status === 429 || response.status >= 500) {
    if (attempt >= 4) throw new Error(`${init.method ?? "GET"} ${route} -> ${response.status} after retries`);
    await sleep(response.status === 429 ? 15_000 : 4_000);
    return call(route, init, attempt + 1);
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${init.method ?? "GET"} ${route} -> ${response.status}: ${body.slice(0, 400)}`);
  }
  return response;
}

export async function upload(bytes: Uint8Array, fileName: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)]), fileName);
  const body = (await (await call("/api/documents/upload", { method: "POST", body: form })).json()) as {
    documentId?: string;
  };
  if (!body.documentId) throw new Error(`upload returned no documentId: ${JSON.stringify(body)}`);
  return body.documentId;
}

interface Task {
  taskId: string;
  status: string;
  resultDocumentId?: string;
  error?: unknown;
}

async function awaitTask(taskId: string): Promise<string> {
  const started = Date.now();
  for (;;) {
    const task = (await (await call(`/api/tasks/${taskId}`)).json()) as Task;
    const status = String(task.status).toUpperCase();
    if (status === "COMPLETED") {
      if (!task.resultDocumentId) throw new Error(`task ${taskId} completed without a result`);
      return task.resultDocumentId;
    }
    if (status === "FAILED") throw new Error(`task ${taskId} failed: ${JSON.stringify(task)}`);
    if (Date.now() - started > 180_000) throw new Error(`task ${taskId} still ${status} after 3 min`);
    await sleep(3_000);
  }
}

export async function download(documentId: string): Promise<Uint8Array> {
  return new Uint8Array(await (await call(`/api/documents/${documentId}/download`)).arrayBuffer());
}

export interface OperationResult {
  bytes: Uint8Array;
  cached: boolean;
}

/**
 * Runs one operation on one input and returns the produced file. The cache key
 * is the input's hash plus the route and parameters, so the same document run
 * through the same operation is paid for once.
 */
export async function operate(
  input: Uint8Array,
  fileName: string,
  route: string,
  params: Record<string, unknown> = {},
): Promise<OperationResult> {
  const key = createHash("sha256")
    .update(input)
    .update(route)
    .update(JSON.stringify(params))
    .digest("hex");
  const cached = path.join(CACHE_DIR, key);
  if (existsSync(cached)) return { bytes: new Uint8Array(await readFile(cached)), cached: true };

  const documentId = await upload(input, fileName);
  const started = (await (
    await call(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId, ...params }),
    })
  ).json()) as Task;
  const resultId = await awaitTask(started.taskId);
  const bytes = await download(resultId);

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cached, bytes);
  return { bytes, cached: false };
}

export const ROUTES = {
  pdfToText: "/api/documents/convert/pdf-to-text",
  pdfToImage: "/api/documents/convert/pdf-to-image",
  pdfFromImage: "/api/documents/create/pdf-from-image",
  pdfOcr: "/api/documents/analyze/pdf-ocr",
  structural: "/api/documents/analyze/pdf-structural-analysis",
  flatten: "/api/documents/modify/pdf-flatten",
  exportFormData: "/api/documents/forms/export-pdf-form-data",
  properties: "/api/documents/analyze/get-pdf-properties",
} as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
