import {defineRendererExtension} from "@notmike101/zcode-extension-sdk/renderer";
import type {RendererExtensionContext} from "@notmike101/zcode-extension-sdk";

window.ZDP_REGISTER_PLUGIN_RENDERER?.(defineRendererExtension({
  id: "model-discovery",
  activate() {},
  async mountPage(pageId: string, container: HTMLElement, context: RendererExtensionContext) {
    if (pageId === "discovery") {
      return mountDiscoveryDashboard(container, context);
    }
  },
}));

function mountDiscoveryDashboard(container: HTMLElement, context: RendererExtensionContext): () => void {
  const root = document.createElement("div");
  Object.assign(root.style, {
    fontFamily: "Inter, system-ui, sans-serif",
    color: "#e2e8f0",
    maxWidth: "800px",
    lineHeight: "1.5",
  });

  root.innerHTML = `
    <div style="margin-bottom: 24px;">
      <h2 style="font-size: 20px; font-weight: 600; margin: 0 0 6px 0; color: #f8fafc;">Model Discovery</h2>
      <p style="font-size: 13px; color: #94a3b8; margin: 0;">
        Automatically fetch model lists from any OpenAI-compatible connection / endpoint at <code>/v1/models</code> and save them to your selected provider.
      </p>
    </div>

    <div style="background: #1e2430; border: 1px solid #334155; border-radius: 10px; padding: 20px;">
      <h3 style="font-size: 15px; font-weight: 600; margin: 0 0 16px 0; color: #f1f5f9;">Manual Query / Custom Endpoint</h3>

      <div style="display: grid; gap: 14px; margin-bottom: 18px;">
        <div>
          <label style="display: block; font-size: 12px; font-weight: 500; color: #94a3b8; margin-bottom: 5px;">Target provider (autofill Base URL / destination to save models)</label>
          <select id="target-provider-select" style="width: 100%; box-sizing: border-box; padding: 8px 12px; border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: white; font-size: 13px;">
            <option value="">-- Loading providers... --</option>
          </select>
        </div>

        <div>
          <label style="display: block; font-size: 12px; font-weight: 500; color: #94a3b8; margin-bottom: 5px;">Base URL</label>
          <input id="manual-base-url" type="text" placeholder="https://api.openai.com/v1 or http://localhost:11434"
                 style="width: 100%; box-sizing: border-box; padding: 8px 12px; border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: white; font-size: 13px;">
        </div>

        <div>
          <label style="display: block; font-size: 12px; font-weight: 500; color: #94a3b8; margin-bottom: 5px;">API Key (optional)</label>
          <input id="manual-api-key" type="password" placeholder="sk-..."
                 style="width: 100%; box-sizing: border-box; padding: 8px 12px; border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: white; font-size: 13px;">
        </div>

        <div style="display: flex; gap: 12px; align-items: center; margin-top: 4px;">
          <button id="manual-fetch-btn" type="button"
                  style="padding: 9px 18px; border-radius: 6px; border: 1px solid #6366f1; background: #4f46e5; color: white; font-size: 13px; font-weight: 500; cursor: pointer;">
            ⚡ Query /v1/models
          </button>
          <span id="manual-fetch-status" style="font-size: 13px; color: #94a3b8;"></span>
        </div>
      </div>

      <div id="manual-models-result" style="display: none; border-top: 1px solid #334155; padding-top: 16px; margin-top: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <strong id="models-count-header" style="font-size: 14px; color: #38bdf8;"></strong>
          <button id="save-models-btn" type="button"
                  style="padding: 7px 16px; border-radius: 6px; border: 1px solid #10b981; background: #059669; color: white; font-size: 13px; font-weight: 500; cursor: pointer;">
            💾 Save to Provider
          </button>
        </div>
        <div id="models-tags-container" style="max-height: 220px; overflow-y: auto; display: flex; flex-wrap: wrap; gap: 6px; padding: 12px; background: #0f172a; border-radius: 6px; border: 1px solid #334155;"></div>
      </div>
    </div>
  `;

  container.replaceChildren(root);

  let cachedProviders: any[] = [];
  let currentDiscoveredModels: string[] = [];

  const providerSelect = root.querySelector("#target-provider-select") as HTMLSelectElement;
  const baseUrlInput = root.querySelector("#manual-base-url") as HTMLInputElement;
  const apiKeyInput = root.querySelector("#manual-api-key") as HTMLInputElement;
  const fetchBtn = root.querySelector("#manual-fetch-btn") as HTMLButtonElement;
  const statusSpan = root.querySelector("#manual-fetch-status") as HTMLElement;
  const resultArea = root.querySelector("#manual-models-result") as HTMLElement;
  const countHeader = root.querySelector("#models-count-header") as HTMLElement;
  const tagsContainer = root.querySelector("#models-tags-container") as HTMLElement;
  const saveBtn = root.querySelector("#save-models-btn") as HTMLButtonElement;

  const loadProviders = async () => {
    try {
      const res = await context.ipc.invoke<any>("list-providers");
      if (!res.success) {
        providerSelect.innerHTML = `<option value="">Error loading providers</option>`;
        return;
      }

      cachedProviders = res.providers || [];
      if (cachedProviders.length === 0) {
        providerSelect.innerHTML = `<option value="">-- No custom providers found in ZCode --</option>`;
        return;
      }

      const prevSelected = providerSelect.value;
      providerSelect.innerHTML = `<option value="">-- Select target provider --</option>` +
        cachedProviders.map((p) => `<option value="${p.id}">${p.name} (${p.models.length} models)</option>`).join("");

      if (prevSelected) {
        providerSelect.value = prevSelected;
      }
    } catch {
      providerSelect.innerHTML = `<option value="">Error loading providers</option>`;
    }
  };

  providerSelect.onchange = () => {
    const selectedId = providerSelect.value;
    const p = cachedProviders.find((x) => x.id === selectedId);
    if (p) {
      if (p.baseURL) {
        baseUrlInput.value = p.baseURL;
      }
      if (p.apiKey) {
        apiKeyInput.value = p.apiKey;
      }
    }
  };

  void loadProviders();

  fetchBtn.onclick = async () => {
    const baseUrl = baseUrlInput.value.trim();
    const apiKey = apiKeyInput.value.trim();

    if (!baseUrl) {
      statusSpan.innerHTML = `<span style="color: #fbbf24;">Please enter a Base URL.</span>`;
      return;
    }

    fetchBtn.disabled = true;
    statusSpan.innerHTML = `<span style="color: #94a3b8;">Querying /v1/models...</span>`;
    resultArea.style.display = "none";

    try {
      const res = await context.ipc.invoke<any>("fetch-models", {baseUrl, apiKey});

      if (!res.success) {
        statusSpan.innerHTML = `<span style="color: #f87171;">${res.error}</span>`;
        context.ui.showToast(res.error, {kind: "error", timeoutMs: 8000});
        return;
      }

      currentDiscoveredModels = res.models || [];
      statusSpan.innerHTML = `<span style="color: #34d399;">✅ Found ${currentDiscoveredModels.length} models at ${res.url}</span>`;
      countHeader.textContent = `Discovered Models (${currentDiscoveredModels.length})`;

      tagsContainer.innerHTML = currentDiscoveredModels.map((m) => `
        <span style="display: inline-block; padding: 3px 8px; border-radius: 4px; background: #1e293b; border: 1px solid #475569; font-size: 11px; font-family: monospace;">
          ${m}
        </span>
      `).join("");

      resultArea.style.display = "block";
    } catch (err: any) {
      statusSpan.innerHTML = `<span style="color: #f87171;">Error: ${err.message || String(err)}</span>`;
    } finally {
      fetchBtn.disabled = false;
    }
  };

  saveBtn.onclick = async () => {
    const selectedProviderId = providerSelect.value;
    if (!selectedProviderId) {
      context.ui.showToast("Select a target provider from the dropdown above to save models.", {kind: "warning"});
      return;
    }

    if (currentDiscoveredModels.length === 0) {
      context.ui.showToast("No discovered models to save.", {kind: "warning"});
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    try {
      const res = await context.ipc.invoke<any>("save-provider-models", {
        providerId: selectedProviderId,
        models: currentDiscoveredModels,
      });

      if (!res.success) {
        context.ui.showToast(res.error || "Error saving models.", {kind: "error"});
        return;
      }

      context.ui.showToast(`✅ Saved ${res.addedCount} new models to ${res.providerName} (${res.totalCount} total).`, {kind: "success"});
      await loadProviders();
    } catch (err: any) {
      context.ui.showToast(`Error: ${err.message || String(err)}`, {kind: "error"});
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "💾 Save to Provider";
    }
  };

  return () => {
    root.remove();
  };
}
