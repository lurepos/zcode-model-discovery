var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  if (mod && typeof mod === "object" || typeof mod === "function") {
    for (let key of __getOwnPropNames(mod))
      if (!__hasOwnProp.call(to, key))
        __defProp(to, key, {
          get: __accessProp.bind(mod, key),
          enumerable: true
        });
  }
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __toCommonJS = (from) => {
  var entry = (__moduleCache ??= new WeakMap).get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function") {
    for (var key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(entry, key))
        __defProp(entry, key, {
          get: __accessProp.bind(from, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
  }
  __moduleCache.set(from, entry);
  return entry;
};
var __moduleCache;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/main.ts
var exports_main = {};
__export(exports_main, {
  activate: () => activate,
  normalizeModelsUrl: () => normalizeModelsUrl,
  parseModelList: () => parseModelList
});
module.exports = __toCommonJS(exports_main);
var import_promises = require("node:fs/promises");
var import_node_os = __toESM(require("node:os"), 1);
var import_node_path = __toESM(require("node:path"), 1);
function normalizeModelsUrl(baseUrl) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/models`;
  }
  return `${trimmed}/v1/models`;
}
function parseModelList(json) {
  const rawList = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
  const models = [];
  for (const item of rawList) {
    const id = typeof item === "string" ? item.trim() : (item?.id || item?.name || "").trim();
    if (id && !models.includes(id)) {
      models.push(id);
    }
  }
  return models.sort();
}
function resolveZCodeConfigPath() {
  const userHome = process.env.USERPROFILE || process.env.HOME || import_node_os.default.homedir();
  return import_node_path.default.join(userHome, ".zcode", "v2", "config.json");
}
async function readZCodeConfig() {
  const configPath = resolveZCodeConfigPath();
  const content = await import_promises.readFile(configPath, "utf-8");
  return { configPath, data: JSON.parse(content) };
}
async function activate(context) {
  await context.logger.info("Model Discovery extension activated");
  context.ipc.handle("list-providers", async () => {
    try {
      const { data } = await readZCodeConfig();
      const providersMap = data?.provider || {};
      const providers = Object.entries(providersMap).map(([id, p]) => ({
        id,
        name: p?.name || id,
        kind: p?.kind || "openai-compatible",
        baseURL: p?.options?.baseURL || "",
        apiKey: p?.options?.apiKey || "",
        models: p?.models ? Object.keys(p.models) : [],
        enabled: p?.enabled !== false
      }));
      return { success: true, providers };
    } catch (error) {
      return {
        success: false,
        error: `Could not read provider list: ${error instanceof Error ? error.message : String(error)}`,
        providers: []
      };
    }
  });
  context.ipc.handle("fetch-models", async (payload) => {
    const { baseUrl, apiKey } = payload || {};
    if (!baseUrl || typeof baseUrl !== "string" || !baseUrl.trim()) {
      return { success: false, error: "Base URL is required." };
    }
    const url = normalizeModelsUrl(baseUrl);
    const headers = {
      Accept: "application/json",
      "User-Agent": "ZCode-Model-Discovery/1.0"
    };
    if (apiKey && typeof apiKey === "string" && apiKey.trim()) {
      headers["Authorization"] = `Bearer ${apiKey.trim()}`;
    }
    try {
      await context.logger.info("Querying models endpoint", { url });
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(15000)
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
          error: `HTTP error ${response.status} (${response.statusText})${detail ? ": " + detail : ""}`
        };
      }
      const json = await response.json();
      const models = parseModelList(json);
      if (models.length === 0) {
        return {
          success: false,
          url,
          error: "Endpoint /v1/models responded with HTTP 200 but returned no models in 'data' or 'models'."
        };
      }
      return {
        success: true,
        url,
        count: models.length,
        models
      };
    } catch (error) {
      const isTimeout = error?.name === "TimeoutError";
      const message = isTimeout ? `Connection timed out (15s) while contacting ${url}` : error instanceof Error ? error.message : String(error);
      return {
        success: false,
        url,
        error: `Connection error with ${url}: ${message}`
      };
    }
  });
  context.ipc.handle("save-provider-models", async (payload) => {
    const { providerId, models } = payload || {};
    if (!providerId || !Array.isArray(models) || models.length === 0) {
      return { success: false, error: "providerId and models list are required." };
    }
    try {
      const { configPath, data } = await readZCodeConfig();
      if (!data.provider || !data.provider[providerId]) {
        return { success: false, error: `Provider '${providerId}' not found in ZCode config.` };
      }
      const target = data.provider[providerId];
      const existing = target.models || {};
      const merged = { ...existing };
      let added = 0;
      for (const modelId of models) {
        if (!merged[modelId]) {
          merged[modelId] = {
            limit: {
              context: 128000,
              output: 128000
            },
            modalities: {
              input: ["text"],
              output: ["text"]
            },
            zcode: {
              modalitiesConfigured: true,
              modified: true
            }
          };
          added++;
        }
      }
      target.models = merged;
      target.updatedAt = Date.now();
      await import_promises.writeFile(configPath, JSON.stringify(data, null, 2), "utf-8");
      try {
        await context.zcode.experimental.channel("model-provider").call("save", target);
      } catch {}
      await context.logger.info("Saved models to provider", { providerId, added, total: Object.keys(merged).length });
      return {
        success: true,
        providerId,
        providerName: target.name || providerId,
        addedCount: added,
        totalCount: Object.keys(merged).length
      };
    } catch (error) {
      return {
        success: false,
        error: `Error saving models to provider: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  });
  context.ipc.handle("discover-and-fill", async (payload) => {
    const { baseUrl, apiKey, providerId } = payload || {};
    if (!baseUrl || typeof baseUrl !== "string" || !baseUrl.trim()) {
      return { success: false, error: "Base URL is required to discover models." };
    }
    const url = normalizeModelsUrl(baseUrl);
    const headers = {
      Accept: "application/json",
      "User-Agent": "ZCode-Model-Discovery/1.0"
    };
    if (apiKey && typeof apiKey === "string" && apiKey.trim()) {
      headers["Authorization"] = `Bearer ${apiKey.trim()}`;
    }
    let models;
    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        let detail = "";
        try {
          const body = await response.text();
          detail = body.slice(0, 250);
        } catch {}
        return {
          success: false,
          error: `HTTP error ${response.status} (${response.statusText}) querying ${url}${detail ? ": " + detail : ""}`
        };
      }
      const json = await response.json();
      models = parseModelList(json);
      if (models.length === 0) {
        return {
          success: false,
          error: `Endpoint ${url} responded with HTTP 200 but model list is empty.`
        };
      }
    } catch (err) {
      const msg = err?.name === "TimeoutError" ? `Connection timed out (15s) contacting ${url}` : err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Failed to query ${url}: ${msg}`
      };
    }
    try {
      const { configPath, data } = await readZCodeConfig();
      const providers = data?.provider || {};
      let targetId = providerId;
      if (!targetId || !providers[targetId]) {
        const cleanBase = baseUrl.trim().replace(/\/+$/, "");
        for (const [id, p] of Object.entries(providers)) {
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
          warning: `Discovered ${models.length} models from ${url}, but no saved provider with that Base URL was found to autofill.`
        };
      }
      const target = providers[targetId];
      const existing = target.models || {};
      const merged = { ...existing };
      let added = 0;
      for (const m of models) {
        if (!merged[m]) {
          merged[m] = {
            limit: { context: 128000, output: 128000 },
            modalities: { input: ["text"], output: ["text"] },
            zcode: { modalitiesConfigured: true, modified: true }
          };
          added++;
        }
      }
      target.models = merged;
      target.updatedAt = Date.now();
      await import_promises.writeFile(configPath, JSON.stringify(data, null, 2), "utf-8");
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
        totalModels: Object.keys(merged).length
      };
    } catch (error) {
      return {
        success: true,
        saved: false,
        count: models.length,
        models,
        warning: `Discovered ${models.length} models, but saving to config failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  });
  return {
    dispose: async () => {
      await context.logger.info("Model Discovery extension disposed");
    }
  };
}

//# debugId=025A8D29DC2D229564756E2164756E21
