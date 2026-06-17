import { requestUrl } from "obsidian";
import type { CachedIcon, FaviconProvider, PluginData, SubscriptionItem } from "../types";
import { todayLocalDate } from "../date/dateOnly";
import { buildGoogleS2FaviconUrl } from "./faviconProviders";
import { getDomainFromUrl } from "./url";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export class IconService {
  constructor(
    private readonly data: PluginData,
    private readonly getProvider: () => FaviconProvider
  ) {}

  getCachedIcon(item: SubscriptionItem): CachedIcon | null {
    const key = item.icon.cacheKey;
    if (!key) return null;
    return this.data.iconCache[key] ?? null;
  }

  clearIcon(item: SubscriptionItem): void {
    const key = item.icon.cacheKey;
    if (key) {
      delete this.data.iconCache[key];
    }
    item.icon = { ...item.icon, cacheKey: undefined };
  }

  async refreshAutoIcon(item: SubscriptionItem): Promise<boolean> {
    if (this.getProvider() === "none") return false;
    const domain = getDomainFromUrl(item.serviceUrl);
    if (!domain) return false;

    const sourceUrl = buildGoogleS2FaviconUrl(domain);
    const response = await requestUrl({ url: sourceUrl });
    const contentType =
      response.headers["content-type"] ??
      response.headers["Content-Type"] ??
      "image/png";
    const dataUrl = `data:${contentType};base64,${arrayBufferToBase64(
      response.arrayBuffer
    )}`;
    const cacheKey = `google-s2:${domain}`;
    this.data.iconCache[cacheKey] = {
      cacheKey,
      sourceUrl,
      serviceDomain: domain,
      dataUrl,
      contentType,
      fetchedOn: todayLocalDate(),
    };
    item.icon = { ...item.icon, mode: "auto", cacheKey };
    return true;
  }

  async ensureAutoIcon(item: SubscriptionItem): Promise<boolean> {
    if (item.icon.mode !== "auto") return false;
    const key = item.icon.cacheKey;
    if (key && this.data.iconCache[key]) return false;
    return this.refreshAutoIcon(item);
  }
}

