import { describe, expect, it, vi } from "vitest";
import { createDefaultData } from "../src/data/defaultData";
import { IconService } from "../src/icons/IconService";
import type { SubscriptionItem } from "../src/types";

function subscription(id: string): SubscriptionItem {
  return {
    id,
    name: id,
    status: "enabled",
    price: { amountMinor: 1000, currencyCode: "USD" },
    billingPeriod: "monthly",
    serviceUrl: "https://example.com",
    icon: { mode: "auto", cacheKey: "google-s2:example.com" },
    createdOn: "2026-08-23",
    updatedOn: "2026-08-23",
  };
}

describe("IconService", () => {
  it("keeps a shared domain cache entry when clearing one subscription icon", () => {
    const data = createDefaultData();
    const first = subscription("first");
    const second = subscription("second");
    data.subscriptions = [first, second];
    data.iconCache["google-s2:example.com"] = {
      cacheKey: "google-s2:example.com",
      sourceUrl: "https://www.google.com/s2/favicons?domain=example.com&sz=64",
      serviceDomain: "example.com",
      dataUrl: "data:image/png;base64,icon",
      contentType: "image/png",
      fetchedOn: "2026-08-23",
    };
    const iconService = new IconService(data, () => "google-s2");

    iconService.clearIcon(first);

    expect(first.icon.cacheKey).toBeUndefined();
    expect(iconService.getCachedIcon(second)?.dataUrl).toBe("data:image/png;base64,icon");
  });

  it("ignores inherited icon-cache properties", async () => {
    const data = createDefaultData();
    const item = subscription("inherited");
    item.icon.cacheKey = "toString";
    data.subscriptions = [item];
    const iconService = new IconService(data, () => "google-s2");
    const refresh = vi.spyOn(iconService, "refreshAutoIcon").mockResolvedValue(true);

    expect(iconService.getCachedIcon(item)).toBeNull();
    await expect(iconService.ensureAutoIcon(item)).resolves.toBe(true);
    expect(refresh).toHaveBeenCalledWith(item);
  });
});
