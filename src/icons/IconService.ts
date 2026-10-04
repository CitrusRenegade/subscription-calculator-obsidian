import { requestUrl } from "obsidian";
import type { CachedIcon, FaviconProvider, PluginData, SubscriptionItem } from "../types";
import { todayLocalDate } from "../date/dateOnly";
import { buildGoogleS2FaviconUrl } from "./faviconProviders";
import { getDomainFromUrl } from "./url";
import { isLocalImageData, MAX_ICON_BYTES, normalizeImageContentType } from "./imageData";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export class IconService {
  private readonly requests = new Map<string, Promise<CachedIcon | null>>();
  constructor(
    private readonly data: PluginData,
    private readonly getProvider: () => FaviconProvider
  ) {}

  getCachedIcon(item: SubscriptionItem): CachedIcon | null {
    const key = item.icon.cacheKey;
    if (!key || !Object.prototype.hasOwnProperty.call(this.data.iconCache, key)) {
      return null;
    }
    const cached = this.data.iconCache[key];
    return cached && isLocalImageData(cached.dataUrl) ? cached : null;
  }

  getReusableIcon(item: SubscriptionItem): CachedIcon | null {
    const domain = getDomainFromUrl(item.serviceUrl);
    if (!domain) return null;
    return this.getCachedIcon({ ...item, icon: { cacheKey: `google-s2:${domain}`, mode: "auto" } });
  }

  attachIcon(item: SubscriptionItem, cached: CachedIcon): void {
    if (!isLocalImageData(cached.dataUrl)) return;
    this.clearIcon(item);
    this.data.iconCache[cached.cacheKey] = { ...cached };
    item.icon = { ...item.icon, mode: "auto", cacheKey: cached.cacheKey };
  }

  clearIcon(item: SubscriptionItem): void {
    const key = item.icon.cacheKey;
    item.icon = { ...item.icon, cacheKey: undefined };
    if (
      key &&
      !this.data.subscriptions.some(
        (candidate) => candidate !== item && candidate.icon.cacheKey === key
      )
    ) {
      delete this.data.iconCache[key];
    }
  }

  async fetchAutoIcon(item: SubscriptionItem, generation = 0): Promise<CachedIcon | null> {
    if (this.getProvider() === "none") return null;
    const domain = getDomainFromUrl(item.serviceUrl);
    if (!domain) return null;
    const key = `${generation}:google-s2:${domain}`;
    const existing = this.requests.get(key);
    if (existing) return existing;
    const request = this.fetchDomainIcon(domain);
    this.requests.set(key, request);
    try { return await request; }
    finally { if (this.requests.get(key) === request) this.requests.delete(key); }
  }

  private async fetchDomainIcon(domain: string): Promise<CachedIcon | null> {
    const sourceUrl = buildGoogleS2FaviconUrl(domain);
    const response = await requestUrl({ url: sourceUrl });
    const contentType = normalizeImageContentType(
      response.headers["content-type"] ??
      response.headers["Content-Type"] ??
      ""
    );
    if (!contentType || !response.arrayBuffer.byteLength || response.arrayBuffer.byteLength > MAX_ICON_BYTES) return null;
    const dataUrl = `data:${contentType};base64,${arrayBufferToBase64(
      response.arrayBuffer
    )}`;
    const cacheKey = `google-s2:${domain}`;
    return {
      cacheKey,
      sourceUrl,
      serviceDomain: domain,
      dataUrl,
      contentType,
      fetchedOn: todayLocalDate(),
    };
  }

  async refreshAutoIcon(item: SubscriptionItem): Promise<boolean> {
    const cached = await this.fetchAutoIcon(item);
    if (!cached) return false;
    this.attachIcon(item, cached);
    return true;
  }

  async ensureAutoIcon(item: SubscriptionItem): Promise<boolean> {
    if (item.icon.mode !== "auto") return false;
    if (this.getCachedIcon(item)) return false;
    const cached = this.getReusableIcon(item);
    if (cached) { this.attachIcon(item, cached); return true; }
    return this.refreshAutoIcon(item);
  }
}
