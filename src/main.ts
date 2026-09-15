import {readFile, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {ExtensionContext} from "@notmike101/zcode-extension-sdk";

export function normalizeModelsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/models`;
  }
  return `${trimmed}/v1/models`;
}

export function parseModelList(json: any): string[] {
  const rawList = Array.isArray(json)
    ? json
    : Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.models)
        ? json.models
        : [];

  const models: string[] = [];
  for (const item of rawList) {
    const id = typeof item === "string" ? item.trim() : (item?.id || item?.name || "").trim();
    if (id && !models.includes(id)) {
      models.push(id);
    }
  }
  return models.sort();
}

function resolveZCodeConfigPath(): string {
  const userHome = process.env.USERPROFILE || process.env.HOME || os.homedir();
  return path.join(userHome, ".zcode", "v2", "config.json");
}

async function readZCodeConfig(): Promise<{configPath: string; data: any}> {
  const configPath = resolveZCodeConfigPath();
  const content = await readFile(configPath, "utf-8");
  return {configPath, data: JSON.parse(content)};
}

export async function activate(context: ExtensionContext) {
  await context.logger.info("Model Discovery extension activated");

  context.ipc.handle("list-providers", async () => {
    try {
      const {data} = await readZCodeConfig();
      const providersMap = data?.provider || {};
      const providers = Object.entries(providersMap).map(([id, p]: [string, any]) => ({
        id,
        name: p?.name || id,
        kind: p?.kind || "openai-compatible",
        baseURL: p?.options?.baseURL || "",
        apiKey: p?.options?.apiKey || "",
        models: p?.models ? Object.keys(p.models) : [],
        enabled: p?.enabled !== false,
      }));
      return {success: true, providers};
    } catch (error) {
      return {
        success: false,
        error: `Could not read provider list: ${error instanceof Error ? error.message : String(error)}`,
        providers: [],
      };
    }
  });

  context.ipc.handle("fetch-models", async (payload: any) => {
    const {baseUrl, apiKey} = payload || {};
    if (!baseUrl || typeof baseUrl !== "string" || !baseUrl.trim()) {
      return {success: false, error: "Base URL is required."};
    }

    const url = normalizeModelsUrl(baseUrl);
    const headers: Record<string, string> = {
      "Accept": "application/json",
      "User-Agent": "ZCode-Model-Discovery/1.0",
    };
    if (apiKey && typeof apiKey === "string" && apiKey.trim()) {
      headers["Authorization"] = `Bearer ${apiKey.trim()}`;
    }

    try {
      await context.logger.info("Querying models endpoint", {url});
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        let detail = "";
        try {
          const body = await response.text();
          detail = body.slice(0, 250);
        } catch {}
        return {
          success: false,
          url,
          status: response.status,
          error: `HTTP error ${response.status} (${response.statusText})${detail ? ": " + detail : ""}`,
        };
      }

      const json = await response.json();
      const models = parseModelList(json);

      if (models.length === 0) {
        return {
          success: false,
          url,
          error: "Endpoint /v1/models responded with HTTP 200 but returned no models in 'data' or 'models'.",
        };
      }

      return {
        success: true,
        url,
        count: models.length,
        models,
      };
    } catch (error: any) {
      const isTimeout = error?.name === "TimeoutError";
      const message = isTimeout
        ? `Connection timed out (15s) while contacting ${url}`
        : error instanceof Error ? error.message : String(error);
      return {
        success: false,
        url,
        error: `Connection error with ${url}: ${message}`,
      };
    }
  });

  context.ipc.handle("save-provider-models", async (payload: any) => {
    const {providerId, models} = payload || {};
    if (!providerId || !Array.isArray(models) || models.length === 0) {
      return {success: false, error: "providerId and models list are required."};
    }

    try {
      const {configPath, data} = await readZCodeConfig();
      if (!data.provider || !data.provider[providerId]) {
        return {success: false, error: `Provider '${providerId}' not found in ZCode config.`};
      }

      const target = data.provider[providerId];
      const existing = target.models || {};
      const merged = {...existing};
      let added = 0;

      for (const modelId of models) {
        if (!merged[modelId]) {
          merged[modelId] = {
            limit: {
              context: 128000,
              output: 128000,
            },
            modalities: {
              input: ["text"],
              output: ["text"],
            },
            zcode: {
              modalitiesConfigured: true,
              modified: true,
            },
          };
          added++;
        }
      }

      target.models = merged;
      target.updatedAt = Date.now();

      await writeFile(configPath, JSON.stringify(data, null, 2), "utf-8");

      try {
        await context.zcode.experimental.channel("model-provider").call("save", target);
      } catch {}

      await context.logger.info("Saved models to provider", {providerId, added, total: Object.keys(merged).length});

      return {
        success: true,
        providerId,
        providerName: target.name || providerId,
        addedCount: added,
        totalCount: Object.keys(merged).length,
      };
    } catch (error) {
      return {
        success: false,
        error: `Error saving models to provider: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  context.ipc.handle("discover-and-fill", async (payload: any) => {
    const {baseUrl, apiKey, providerId} = payload || {};
    if (!baseUrl || typeof baseUrl !== "string" || !baseUrl.trim()) {
      return {success: false, error: "Base URL is required to discover models."};
    }

    const url = normalizeModelsUrl(baseUrl);
    const headers: Record<string, string> = {
      "Accept": "application/json",
      "User-Agent": "ZCode-Model-Discovery/1.0",
    };
    if (apiKey && typeof apiKey === "string" && apiKey.trim()) {
      headers["Authorization"] = `Bearer ${apiKey.trim()}`;
    }

    let models: string[];
    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        let detail = "";
        try {
          const body = await response.text();
          detail = body.slice(0, 250);
        } catch {}
        return {
          success: false,
          error: `HTTP error ${response.status} (${response.statusText}) querying ${url}${detail ? ": " + detail : ""}`,
        };
      }

      const json = await response.json();
      models = parseModelList(json);

      if (models.length === 0) {
        return {
          success: false,
          error: `Endpoint ${url} responded with HTTP 200 but model list is empty.`,
        };
      }
    } catch (err: any) {
      const msg = err?.name === "TimeoutError"
        ? `Connection timed out (15s) contacting ${url}`
        : err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Failed to query ${url}: ${msg}`,
      };
    }

    try {
      const {configPath, data} = await readZCodeConfig();
      const providers = data?.provider || {};
      let targetId = providerId;

      if (!targetId || !providers[targetId]) {
        const cleanBase = baseUrl.trim().replace(/\/+$/, "");
        for (const [id, p] of Object.entries(providers) as [string, any][]) {
          const pBase = (p?.options?.baseURL || "").trim().replace(/\/+$/, "");
          if (pBase === cleanBase || cleanBase.startsWith(pBase) || pBase.startsWith(cleanBase)) {
            targetId = id;
            break;
          }
        }
      }

      if (!targetId || !providers[targetId]) {
        return {
          success: true,
          saved: false,
          count: models.length,
          models,
          warning: `Discovered ${models.length} models from ${url}, but no saved provider with that Base URL was found to autofill.`,
        };
      }

      const target = providers[targetId];
      const existing = target.models || {};
      const merged = {...existing};
      let added = 0;

      for (const m of models) {
        if (!merged[m]) {
          merged[m] = {
            limit: {context: 128000, output: 128000},
            modalities: {input: ["text"], output: ["text"]},
            zcode: {modalitiesConfigured: true, modified: true},
          };
          added++;
        }
      }

      target.models = merged;
      target.updatedAt = Date.now();

      await writeFile(configPath, JSON.stringify(data, null, 2), "utf-8");

      try {
        await context.zcode.experimental.channel("model-provider").call("save", target);
      } catch {}

      return {
        success: true,
        saved: true,
        providerId: targetId,
        providerName: target.name || targetId,
        count: models.length,
        addedCount: added,
        totalModels: Object.keys(merged).length,
      };
    } catch (error) {
      return {
        success: true,
        saved: false,
        count: models.length,
        models,
        warning: `Discovered ${models.length} models, but saving to config failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  return {
    dispose: async () => {
      await context.logger.info("Model Discovery extension disposed");
    },
  };
}
