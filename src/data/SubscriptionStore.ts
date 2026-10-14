import { Notice } from "obsidian";
import {
  DEFAULT_CUSTOM_BILLING_PERIOD_DAYS,
  DISABLE_GRACE_PERIOD_MS,
  MAX_CUSTOM_BILLING_PERIOD_DAYS,
} from "../constants";
import type {
  AddSubscriptionInput,
  CachedIcon,
  CurrencyMeta,
  MoneyTotal,
  PluginData,
  SubscriptionItem,
  SubscriptionViewItem,
  UpdateSubscriptionInput,
} from "../types";
import type { IconService } from "../icons/IconService";
import type { CurrencyRegistry } from "../money/CurrencyRegistry";
import type { Clock } from "../date/Clock";
import { systemClock } from "../date/Clock";
import { parseDateOnly, todayLocalDate } from "../date/dateOnly";
import { getDomainFromUrl, normalizeUrlInput } from "../icons/url";
import { moneyToInputValue } from "../money/formatMoney";
import { parseMoneyInput } from "../money/parseMoneyInput";
import { calculateTotalsByCurrency } from "../money/totals";
import { restoreBackupData, type BackupImportReport } from "./backup";
import { getCurrencySelectLabel } from "../money/currencyDisplay";
import {
  type CustomCurrencyInput,
  normalizeCustomCurrencyInput,
  normalizeNewCustomCurrencyInput,
} from "../money/currencyValidation";
import {
  buildCreateCandidate,
  buildSetCandidate,
  isBillingPeriodValue,
  isValidCustomPeriodDays,
  StoreCommandError,
} from "./subscriptionCommands";
import type {
  SubscriptionCommandOptions,
  SubscriptionCommandResult,
  SubscriptionCreateCommand,
  SubscriptionSetCommand,
} from "../types";

/**
 * A pending runtime status intent. Enables never create intents; a disable intent
 * holds its timer identity generation, the GUI action sequence it was created at,
 * and the absolute clock time when the disable persists, so rollbacks can reinstate
 * the exact remaining undo time under a fresh identity.
 */
interface StatusIntent {
  subscriptionId: string;
  generation: number;
  actionSequence: number;
  datasetGeneration: number;
  deadline: number;
  timeoutId: number;
}

interface CommandTx {
  persistedChanged: boolean;
  runtimeChanged: boolean;
  urlChanged: boolean;
  /** Record whose favicon ensure launches after the primary save. */
  iconTargetId: string | null;
  /** Builds the detached result inside the queue slot, after the primary save. */
  captureResult: () => SubscriptionCommandResult;
}

export interface IconRefreshSummary {
  refreshed: number;
  failed: number;
  skipped: number;
}

interface IconRequest {
  promise: Promise<CachedIcon | null>;
  domainRevision: number;
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createCustomCurrencyCode(): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(bytes);
    return `CUSTOM_${Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("").toUpperCase()}`;
  }
  return `CUSTOM_${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

function normalizeCurrencyCode(code: string): string {
  return code.trim().toUpperCase();
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

function isMvpCurrencyScale(value: number): boolean {
  return value === 0 || value === 2;
}

function clonePluginData(data: PluginData): PluginData {
  const iconCache: PluginData["iconCache"] = {};
  for (const [key, icon] of Object.entries(data.iconCache)) {
    Object.defineProperty(iconCache, key, {
      value: { ...icon },
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  return {
    schemaVersion: data.schemaVersion,
    settings: { ...data.settings },
    subscriptions: data.subscriptions.map((item) => ({
      ...item,
      price: { ...item.price },
      icon: { ...item.icon },
    })),
    iconCache,
    customCurrencies: data.customCurrencies.map((currency) => ({ ...currency })),
  };
}

function restorePluginData(target: PluginData, replacement: PluginData): void {
  target.schemaVersion = replacement.schemaVersion;
  target.settings = replacement.settings;
  target.subscriptions = replacement.subscriptions;
  target.iconCache = replacement.iconCache;
  target.customCurrencies = replacement.customCurrencies;
}

export class SubscriptionStore {
  private readonly listeners = new Set<() => void>();
  /**
   * Runtime ordering state (never persisted). How the pieces interlock:
   * - statusIntents: live pending disables (the undo window), one timer each.
   * - statusGenerations: monotonic per-record identity; timers and reinstatements
   *   recognize their own era, stale callbacks are dropped, counters never rewind.
   * - guiActionSequences: monotonic per-record GUI action counter; only a later
   *   GUI action supersedes an earlier CLI status command.
   * - datasetGeneration: whole-dataset era, bumped when a restore replaces the
   *   data; per-record state from a previous dataset never touches the new one.
   * - provisionalAbsences/absenceReconcileIds: park GUI actions for records
   *   temporarily hidden by an in-flight delete/restore so queue order matches
   *   user order; owner tokens keep older cleanups from clearing newer markers.
   * - restoreSeq/restoreSettledOk/restoreEra: identify clicks made during an
   *   in-flight restore; they survive a failed restore and are canceled by a
   *   successful one.
   */
  private readonly statusIntents = new Map<string, StatusIntent>();
  /** Timer identity per id; bumped at intent creation and reinstatement, never rewound. */
  private readonly statusGenerations = new Map<string, number>();
  /**
   * GUI action ordering per id; bumped only by GUI enable/disable invocations. CLI
   * commands read it as a supersession token, so only a later GUI action supersedes
   * an earlier CLI command — CLI commands never supersede each other (queue order does).
   */
  private readonly guiActionSequences = new Map<string, number>();
  /**
   * Records provisionally removed by an unresolved delete or restore; a parked GUI intent
   * enqueues its reconciliation at invocation so queue order matches user order.
   * Each marker is owned by the operation that created it: an older
   * execution's cleanup must never clear a newer execution's marker.
   */
  private readonly provisionalAbsences = new Map<string, number>();
  private nextProvisionalToken = 0;
  private readonly absenceReconcileIds = new Set<string>();
  /** Monotonic restore attempts; a GUI click made during one is canceled iff it succeeds. */
  private restoreSeq = 0;
  /** Outcome of attempt #restoreSeq: null while that restore is still in flight. */
  private restoreSettledOk: boolean | null = null;
  /** Disable intents armed during an in-flight restore, stamped with that restore's seq. */
  private readonly restoreEra = new Map<string, number>();
  private writeQueue: Promise<void> = Promise.resolve();
  private disposed = false;
  /** True while a disable-expiry failure episode has already notified the user. */
  private saveFailureNoticeShown = false;
  private iconEpoch = 0;
  /**
   * Bumped when a restore replaces the dataset so stale timers die with it. It never
   * invalidates queued explicit commands, which validate against the settled dataset.
   */
  private datasetGeneration = 0;
  private readonly iconRevisions = new Map<string, number>();
  private readonly iconDomainRevisions = new Map<string, number>();

  constructor(
    private readonly data: PluginData,
    private readonly currencyRegistry: CurrencyRegistry,
    private readonly iconService: IconService,
    private readonly saveData: () => Promise<void>,
    private readonly clock: Clock = systemClock
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    if (this.statusIntents.size) {
      void this.flushDisableGracePeriods().catch((error) => {
        console.error("Failed to save delayed subscription changes:", error);
      });
    }
    this.listeners.clear();
  }

  async flushDisableGracePeriods(): Promise<void> {
    await this.enqueueWrite(() => this.flushDisableGracePeriodsNow());
  }

  private async flushDisableGracePeriodsNow(): Promise<void> {
    if (!this.statusIntents.size) return;

    const pendingIntents = Array.from(this.statusIntents.values());
    const previousStates = new Map<
      string,
      Pick<SubscriptionItem, "status" | "disabledOn" | "updatedOn">
    >();
    for (const intent of pendingIntents) {
      const item = this.findItem(intent.subscriptionId);
      if (!item) continue;

      previousStates.set(intent.subscriptionId, {
        status: item.status,
        disabledOn: item.disabledOn,
        updatedOn: item.updatedOn,
      });
    }

    for (const intent of pendingIntents) {
      window.clearTimeout(intent.timeoutId);
    }

    const subscriptionIds = pendingIntents.map((intent) => intent.subscriptionId);
    this.statusIntents.clear();
    this.restoreEra.clear();

    let changed = false;
    for (const id of subscriptionIds) {
      changed = this.disableSubscriptionNow(id) || changed;
    }

    if (changed) {
      try {
        await this.saveData();
      } catch (error) {
        for (const intent of pendingIntents) {
          const { subscriptionId: id, generation } = intent;
          const previous = previousStates.get(id);
          const item = this.findItem(id);
          if (item && previous) Object.assign(item, previous);
          if (
            !this.disposed &&
            !this.statusIntents.has(id) &&
            (this.guiActionSequences.get(id) ?? 0) === intent.actionSequence &&
            this.statusGenerations.get(id) === generation
          ) {
            // Re-arm under a fresh identity with the original deadline; never a
            // fresh undo interval, and never over a newer GUI action.
            this.scheduleDisableIntent(id, this.nextStatusGeneration(id), intent.deadline);
          }
        }
        throw error;
      }
      this.notify();
    }
  }

  notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error("Subscription view listener failed:", error);
      }
    }
  }

  private enqueueWrite<T>(operation: () => T | Promise<T>): Promise<T> {
    const queued = this.writeQueue.then(operation);
    this.writeQueue = queued.then(
      () => undefined,
      () => undefined
    );
    return queued;
  }

  private async mutateAndSave<T>(
    mutation: () => T | Promise<T>,
    shouldSave: (result: T) => boolean = () => true,
    notifyOnRollback = true,
    onRollback: () => void = () => undefined,
    precondition?: () => void
  ): Promise<T> {
    return this.enqueueWrite(async () => {
      // Evaluated before the snapshot: a rejected precondition leaves every
      // reference, record and runtime structure untouched. Default policy: a
      // disposed store refuses new mutations; a caller that must run while
      // disposed (expiry retry) passes its own precondition as an exemption.
      if (precondition) precondition();
      else if (this.disposed) throw this.unavailable();
      const previous = clonePluginData(this.data);
      let result!: T;
      try {
        result = await mutation();
        if (!shouldSave(result)) return result;
        await this.saveData();
      } catch (error) {
        restorePluginData(this.data, previous);
        onRollback();
        if (notifyOnRollback) this.notify();
        throw error;
      }
      this.notify();
      return result;
    });
  }

  /** A detached snapshot taken after preceding saves and their rollback have settled. */
  async readSnapshot(): Promise<{ data: PluginData; subscriptions: SubscriptionViewItem[] }> {
    return this.enqueueWrite(() => {
      const data = clonePluginData(this.data);
      return {
        data,
        subscriptions: data.subscriptions.map((item) => this.toViewItem(item)),
      };
    });
  }

  async updateSettings(
    mutation: (settings: PluginData["settings"]) => void
  ): Promise<void> {
    await this.mutateAndSave(() => {
      const previousProvider = this.data.settings.faviconProvider;
      mutation(this.data.settings);
      if (previousProvider !== this.data.settings.faviconProvider) this.iconEpoch++;
      this.ensureDefaultCurrencyValid();
    }, () => true, true);
  }

  async restoreBackupJson(
    text: string,
    confirmRestore: (report: BackupImportReport) => boolean
  ): Promise<BackupImportReport | null> {
    return this.enqueueWrite(async () => {
      if (this.disposed) throw this.unavailable();
      this.restoreSeq++;
      this.restoreSettledOk = null;
      const originalIds = this.data.subscriptions.map((item) => item.id);
      try {
        const report = await this.runRestore(text, confirmRestore, originalIds);
        this.restoreSettledOk = true;
        return report;
      } catch (error) {
        this.restoreSettledOk = false;
        throw error;
      }
    });
  }

  /** Identifies an in-flight restore at click time; null when no restore is in flight. */
  private restoreWindowCapture(): { seq: number } | null {
    return this.restoreSettledOk === null ? { seq: this.restoreSeq } : null;
  }

  private async runRestore(
    text: string,
    confirmRestore: (report: BackupImportReport) => boolean,
    originalIds: string[]
  ): Promise<BackupImportReport | null> {
    return restoreBackupData(this.data, text, {
      confirm: (report) => {
        const confirmed = confirmRestore(report);
        if (confirmed) this.iconEpoch++;
        return confirmed;
      },
      flush: () => this.flushDisableGracePeriodsNow(),
      // Intents created for the replacement dataset must outlive its rollback,
      // so the generation only advances once the flush has actually committed.
      afterFlush: () => {
        // Old runtime intents must never touch records restored under a reused id.
        this.datasetGeneration++;
        this.dropStaleStatusIntents();
      },
      save: async () => {
        // Old cards can still receive GUI actions until restore settles and
        // notifies. Park actions for excluded IDs, just as for an in-flight delete.
        const absentIds = originalIds.filter((id) => !this.findItem(id));
        const ownerToken = ++this.nextProvisionalToken;
        for (const id of absentIds) this.provisionalAbsences.set(id, ownerToken);
        try {
          await this.saveData();
          // Cancel clicks from this restore before notifying views or allowing
          // unload/another restore to flush them into the replacement dataset.
          for (const [id, era] of this.restoreEra) {
            if (era === this.restoreSeq) this.clearDisableIntent(id);
          }
        } finally {
          for (const id of absentIds) {
            if (this.provisionalAbsences.get(id) === ownerToken) this.provisionalAbsences.delete(id);
          }
        }
      },
      notify: () => this.notify(),
    });
  }

  private findItem(id: string): SubscriptionItem | null {
    return this.data.subscriptions.find((item) => item.id === id) ?? null;
  }

  private findCustomCurrency(code: string): CurrencyMeta | null {
    const normalized = normalizeCurrencyCode(code);
    return (
      this.data.customCurrencies.find(
        (currency) => normalizeCurrencyCode(currency.code) === normalized
      ) ?? null
    );
  }

  private ensureDefaultCurrencyValid(): boolean {
    const defaultCurrency = this.currencyRegistry.getDefault().code;
    if (this.data.settings.defaultCurrency === defaultCurrency) return false;

    this.data.settings.defaultCurrency = defaultCurrency;
    return true;
  }

  private assertUniqueCurrencyDisplay(
    next: Pick<CurrencyMeta, "code" | "label" | "amountMarker" | "scale" | "source">,
    currentCode?: string
  ): void {
    const normalizedCurrentCode = currentCode
      ? normalizeCurrencyCode(currentCode)
      : null;
    const nextDisplay = getCurrencySelectLabel(next).toLocaleLowerCase();
    const duplicate = this.currencyRegistry
      .listSelectable()
      .some(
        (currency) =>
          normalizeCurrencyCode(currency.code) !== normalizedCurrentCode &&
          getCurrencySelectLabel(currency).toLocaleLowerCase() === nextDisplay
      );

    if (duplicate) {
      throw new Error("A currency with this label already exists.");
    }
  }

  private pruneUnusedArchivedCustomCurrencies(): boolean {
    const usedCurrencyCodes = new Set(
      this.data.subscriptions.map((item) =>
        normalizeCurrencyCode(item.price.currencyCode)
      )
    );
    const before = this.data.customCurrencies.length;
    this.data.customCurrencies = this.data.customCurrencies.filter(
      (currency) =>
        !currency.isArchived || usedCurrencyCodes.has(normalizeCurrencyCode(currency.code))
    );
    return this.data.customCurrencies.length !== before;
  }

  private getEffectiveStatus(item: SubscriptionItem): "enabled" | "disabled" {
    return this.statusIntents.has(item.id) ? "disabled" : item.status;
  }

  private toViewItem(item: SubscriptionItem): SubscriptionViewItem {
    return {
      ...item,
      effectiveStatus: this.getEffectiveStatus(item),
      inDisableGracePeriod: this.statusIntents.has(item.id),
    };
  }

  async addSubscription(input: AddSubscriptionInput): Promise<void> {
    const id = await this.mutateAndSave(() => {
      const name = input.name.trim();
      if (!name) throw new Error("Subscription name is required.");

      const currencyCode = input.currencyCode.trim().toUpperCase();
      const money = parseMoneyInput(input.priceText, currencyCode, this.currencyRegistry);
      if (!money) throw new Error("Enter a valid price for the selected currency.");

      if (!isBillingPeriodValue(input.billingPeriod)) {
        throw new Error("Select a valid billing period.");
      }
      const startDate = input.startDate?.trim()
        ? parseDateOnly(input.startDate) ?? undefined
        : undefined;
      if (input.startDate?.trim() && !startDate) {
        throw new Error("Select a valid start date.");
      }
      if (
        input.billingPeriod === "custom" &&
        !isValidCustomPeriodDays(input.customBillingPeriodDays)
      ) {
        throw new Error(
          `Custom billing period must be between 1 and ${MAX_CUSTOM_BILLING_PERIOD_DAYS} days.`
        );
      }

      const today = todayLocalDate(this.clock);
      const status = input.status === "disabled" ? "disabled" : "enabled";
      const item: SubscriptionItem = {
        id: createId(),
        name,
        status,
        price: money,
        startDate,
        billingPeriod: input.billingPeriod,
        customBillingPeriodDays:
          input.billingPeriod === "custom" ? input.customBillingPeriodDays : undefined,
        serviceUrl: normalizeUrlInput(input.serviceUrl),
        icon: {
          mode: input.icon?.mode ?? "auto",
          emoji: input.icon?.emoji?.trim() || undefined,
        },
        createdOn: today,
        updatedOn: today,
      };

      this.data.subscriptions.push(item);
      return item.id;
    }, () => true, true);
    await this.tryEnsureIcon(id);
  }

  /**
   * Strict `new` command: one queued atomic validation+mutation+save with the default
   * currency resolved inside the queue. Favicon work starts only after the primary save
   * and never delays the returned financial result.
   */
  async createSubscription(
    command: SubscriptionCreateCommand,
    options: SubscriptionCommandOptions = {}
  ): Promise<SubscriptionCommandResult> {
    if (options.dryRun) {
      // Previews queue too: they must observe settled state, never an unresolved
      // transaction. Advisory means no lock after completion, not a queue bypass.
      return this.enqueueWrite(() => this.previewCreate(command));
    }
    // The command transaction owns the single queue slot for the whole operation.
    return this.runCreateSubscription(command);
  }

  /**
   * Strict `set` command: one queued atomic save for all requested fields and the
   * immediate status. Semantic no-ops save nothing and change no dates. Invocation
   * only reads a status ordering token, so queued validation can never leave stale
   * runtime metadata behind; the monotonic generation advances when the validated
   * operation actually applies.
   */
  async setSubscription(
    id: string,
    changes: SubscriptionSetCommand,
    options: SubscriptionCommandOptions = {}
  ): Promise<SubscriptionCommandResult> {
    if (options.dryRun) {
      // Previews queue too: they must observe settled state, never an unresolved
      // transaction. Advisory means no lock after completion, not a queue bypass.
      return this.enqueueWrite(() => this.previewSet(id, changes));
    }
    const statusToken = changes.status === undefined
      ? undefined
      : { sequence: this.guiActionSequences.get(id) ?? 0 };
    return this.runSetSubscription(id, changes, statusToken);
  }

  private unavailable(): StoreCommandError {
    return new StoreCommandError(
      "UNAVAILABLE",
      "The subscription store is no longer available."
    );
  }

  /**
   * One queue slot per command: validate/mutate, persist, and return. The snapshot
   * is taken lazily at the first mutation, so a pure validation failure keeps every
   * data reference (and timer/listener state) untouched. Validation failures roll
   * back silently; persistence failures notify and surface as SAVE_FAILED, while
   * unexpected mutation errors classify as INTERNAL_ERROR.
   */
  private async runCommandTransaction(
    mutation: (beginMutation: () => void) => CommandTx,
    onRollback: () => void
  ): Promise<{ tx: CommandTx; result: SubscriptionCommandResult }> {
    return this.enqueueWrite(async () => {
      let previous: PluginData | null = null;
      const beginMutation = () => {
        if (!previous) previous = clonePluginData(this.data);
      };
      let phase: "mutation" | "persist" = "mutation";
      let tx: CommandTx;
      try {
        tx = mutation(beginMutation);
        if (!tx.persistedChanged) {
          return { tx, result: tx.captureResult() };
        }
        phase = "persist";
        await this.saveData();
      } catch (error) {
        if (previous) {
          restorePluginData(this.data, previous);
          onRollback();
        }
        if (error instanceof StoreCommandError) throw error;
        // Only a begun transaction can have changed state that views need to re-read.
        if (previous) this.notify();
        throw new StoreCommandError(
          phase === "persist" ? "SAVE_FAILED" : "INTERNAL_ERROR",
          phase === "persist"
            ? "Saving the subscription failed."
            : "The subscription change failed unexpectedly.",
          undefined,
          error
        );
      }
      // Captured after the primary save, still inside the slot: results describe
      // their own transaction and can never alias later mutations.
      const result = tx.captureResult();
      this.notify();
      return { tx, result };
    });
  }

  private async runCreateSubscription(
    command: SubscriptionCreateCommand
  ): Promise<SubscriptionCommandResult> {
    const { tx, result } = await this.runCommandTransaction((beginMutation) => {
      if (this.disposed) throw this.unavailable();
      const candidate = buildCreateCandidate(this.data, this.currencyRegistry, command);
      beginMutation();
      const today = todayLocalDate(this.clock);
      const item: SubscriptionItem = {
        id: createId(),
        name: candidate.name,
        status: candidate.status,
        price: { ...candidate.price },
        startDate: candidate.startDate,
        billingPeriod: candidate.billingPeriod,
        customBillingPeriodDays: candidate.customBillingPeriodDays,
        serviceUrl: candidate.serviceUrl,
        icon: { mode: "auto" },
        createdOn: today,
        updatedOn: today,
      };
      this.data.subscriptions.push(item);
      return {
        persistedChanged: true,
        runtimeChanged: false,
        urlChanged: false,
        iconTargetId: item.serviceUrl ? item.id : null,
        captureResult: () => this.snapshotCommandResult(item, candidate.currency, true, false),
      };
    }, () => undefined);
    if (tx.iconTargetId) this.queueBackgroundIcon(tx.iconTargetId);
    return result;
  }

  private async runSetSubscription(
    id: string,
    changes: SubscriptionSetCommand,
    statusToken: { sequence: number } | undefined
  ): Promise<SubscriptionCommandResult> {
    let reinstate: (() => void) | null = null;
    const { tx, result } = await this.runCommandTransaction((beginMutation) => {
      if (this.disposed) throw this.unavailable();
      const item = this.findItem(id);
      if (!item) {
        throw new StoreCommandError("NOT_FOUND", "Subscription not found.", "id");
      }
      const candidate = buildSetCandidate(item, this.data, this.currencyRegistry, changes);
      // A record whose stored currency no longer resolves fails like list/get do:
      // the result could not describe its price exactly, so nothing mutates.
      const currency = candidate?.currency ?? this.currencyRegistry.get(item.price.currencyCode);
      if (!currency) {
        throw new StoreCommandError("VALIDATION_FAILED", "Unknown currency.", "currency");
      }
      // Rollback only needs the snapshot when data can actually change; a semantic
      // no-op (or a runtime-only intent consumption) skips the O(dataset) clone.
      if (candidate || (changes.status !== undefined && item.status !== changes.status)) beginMutation();

      let persistedChanged = false;
      let runtimeChanged = false;
      let urlChanged = false;
      let consumedDeadline: number | undefined;

      if (statusToken) {
        // setSubscription builds the token exactly when changes.status is set;
        // only a token-bearing command may consume or supersede a pending intent.
        // Only a GUI action invoked after this command supersedes it; CLI commands
        // never supersede each other — queue order decides those.
        const superseded = (this.guiActionSequences.get(id) ?? 0) !== statusToken.sequence;
        if (!superseded) {
          const pending = this.statusIntents.get(id);
          if (pending) {
            window.clearTimeout(pending.timeoutId);
            this.statusIntents.delete(id);
            // The intent's restore era belongs to it and must not cancel a later intent.
            this.restoreEra.delete(id);
            runtimeChanged = true;
            consumedDeadline = pending.deadline;
          }
          if (item.status !== changes.status) {
            if (changes.status === "enabled") {
              item.status = "enabled";
              item.disabledOn = undefined;
            } else {
              item.status = "disabled";
              item.disabledOn = todayLocalDate(this.clock);
            }
            persistedChanged = true;
          }
          if (runtimeChanged) {
            // A later failure reinstates the intent under a fresh monotonic
            // identity with its original deadline; counters are never rewound.
            reinstate = () => {
              if (this.disposed || this.statusIntents.has(id)) return;
              if ((this.guiActionSequences.get(id) ?? 0) !== statusToken.sequence) return;
              this.scheduleDisableIntent(id, this.nextStatusGeneration(id), consumedDeadline);
            };
          }
        }
      }

      if (candidate) {
        if (candidate.name !== undefined) item.name = candidate.name;
        if (candidate.price) item.price = { ...candidate.price };
        if (candidate.billingPeriod !== undefined) {
          item.billingPeriod = candidate.billingPeriod;
          item.customBillingPeriodDays = candidate.customBillingPeriodDays;
        }
        if (candidate.startDate !== undefined) item.startDate = candidate.startDate ?? undefined;
        if (candidate.serviceUrl !== undefined) {
          item.serviceUrl = candidate.serviceUrl ?? undefined;
          // The previously cached icon must not survive a URL change or clear; the
          // revision bump discards any in-flight response for the superseded URL.
          this.iconService.clearIcon(item);
          this.nextIconRevision(id);
          urlChanged = true;
        }
        persistedChanged = true;
      }

      if (persistedChanged) item.updatedOn = todayLocalDate(this.clock);
      return {
        persistedChanged,
        runtimeChanged,
        urlChanged,
        iconTargetId: urlChanged ? id : null,
        captureResult: () =>
          this.snapshotCommandResult(item, currency, persistedChanged || runtimeChanged, false),
      };
    }, () => reinstate?.());

    if (tx.urlChanged) this.queueBackgroundIcon(id);
    // A runtime-only change (intent consumed without persisted edits) still updates views.
    if (tx.runtimeChanged && !tx.persistedChanged) this.notify();
    return result;
  }

  /** Fully detached capture; must run inside the owning queue slot. */
  private snapshotCommandResult(
    item: SubscriptionItem,
    currency: CurrencyMeta,
    changed: boolean,
    dryRun: boolean
  ): SubscriptionCommandResult {
    return {
      id: item.id,
      item: { ...item, price: { ...item.price }, icon: { ...item.icon } },
      currencyScale: currency.scale,
      currencyArchived: currency.isArchived === true,
      persistedStatus: item.status,
      effectiveStatus: this.getEffectiveStatus(item),
      statusPending: this.statusIntents.has(item.id),
      changed,
      dryRun,
    };
  }

  private previewCreate(command: SubscriptionCreateCommand): SubscriptionCommandResult {
    if (this.disposed) throw this.unavailable();
    const candidate = buildCreateCandidate(this.data, this.currencyRegistry, command);
    const today = todayLocalDate(this.clock);
    return {
      id: null,
      item: {
        id: "",
        name: candidate.name,
        status: candidate.status,
        price: { ...candidate.price },
        startDate: candidate.startDate,
        billingPeriod: candidate.billingPeriod,
        customBillingPeriodDays: candidate.customBillingPeriodDays,
        serviceUrl: candidate.serviceUrl,
        icon: { mode: "auto" },
        createdOn: today,
        updatedOn: today,
      },
      currencyScale: candidate.currency.scale,
      currencyArchived: candidate.currency.isArchived === true,
      persistedStatus: candidate.status,
      effectiveStatus: candidate.status,
      statusPending: false,
      changed: true,
      dryRun: true,
    };
  }

  /** Pure prediction over local copies; real maps, timers and counters stay untouched. */
  private previewSet(id: string, changes: SubscriptionSetCommand): SubscriptionCommandResult {
    if (this.disposed) throw this.unavailable();
    const item = this.findItem(id);
    if (!item) throw new StoreCommandError("NOT_FOUND", "Subscription not found.", "id");
    const candidate = buildSetCandidate(item, this.data, this.currencyRegistry, changes);
    const currency = candidate?.currency ?? this.currencyRegistry.get(item.price.currencyCode);
    if (!currency) {
      throw new StoreCommandError("VALIDATION_FAILED", "Unknown currency.", "currency");
    }
    const previewItem: SubscriptionItem = {
      ...item,
      price: { ...item.price },
      icon: { ...item.icon },
    };

    let persistedChanged = false;
    let runtimeChanged = false;
    if (changes.status !== undefined) {
      // A commit issued now would never be superseded, so the status applies.
      if (this.statusIntents.has(id)) runtimeChanged = true;
      if (item.status !== changes.status) {
        previewItem.status = changes.status;
        previewItem.disabledOn = changes.status === "disabled" ? todayLocalDate(this.clock) : undefined;
        persistedChanged = true;
      }
    }
    if (candidate) {
      if (candidate.name !== undefined) previewItem.name = candidate.name;
      if (candidate.price) previewItem.price = { ...candidate.price };
      if (candidate.billingPeriod !== undefined) {
        previewItem.billingPeriod = candidate.billingPeriod;
        previewItem.customBillingPeriodDays = candidate.customBillingPeriodDays;
      }
      if (candidate.startDate !== undefined) previewItem.startDate = candidate.startDate ?? undefined;
      if (candidate.serviceUrl !== undefined) previewItem.serviceUrl = candidate.serviceUrl ?? undefined;
      persistedChanged = true;
    }
    if (persistedChanged) previewItem.updatedOn = todayLocalDate(this.clock);

    const pending = runtimeChanged ? false : this.statusIntents.has(id);
    return {
      id: previewItem.id,
      item: previewItem,
      currencyScale: currency.scale,
      currencyArchived: currency.isArchived === true,
      persistedStatus: previewItem.status,
      effectiveStatus: pending ? "disabled" : previewItem.status,
      statusPending: pending,
      changed: persistedChanged || runtimeChanged,
      dryRun: true,
    };
  }

  /** Network work is never awaited by financial commands; revision/epoch guards protect it. */
  private queueBackgroundIcon(id: string): void {
    void this.fetchAndCommitIcon(id, true).catch((error) => {
      console.warn("Failed to fetch subscription icon:", error);
    });
  }

  async addCustomCurrency(input: CustomCurrencyInput): Promise<void> {
    await this.mutateAndSave(() => {
      const normalized = normalizeNewCustomCurrencyInput(input);
      if (!normalized) throw new Error("Enter valid custom currency details.");

      let code = createCustomCurrencyCode();
      while (this.currencyRegistry.get(code)) {
        code = createCustomCurrencyCode();
      }

      const currency: CurrencyMeta = {
        code,
        label: normalized.label,
        amountMarker: normalized.amountMarker,
        scale: normalized.scale,
        source: "custom",
      };
      this.assertUniqueCurrencyDisplay(currency);
      this.data.customCurrencies.push(currency);
    }, () => true, true);
  }

  async cleanupUnusedArchivedCustomCurrencies(): Promise<void> {
    await this.mutateAndSave(
      () => {
        const defaultChanged = this.ensureDefaultCurrencyValid();
        const pruned = this.pruneUnusedArchivedCustomCurrencies();
        return defaultChanged || pruned;
      },
      (changed) => changed,
      true
    );
  }

  async updateCustomCurrency(
    code: string,
    patch: Partial<CustomCurrencyInput>
  ): Promise<void> {
    await this.mutateAndSave(() => {
      const currency = this.findCustomCurrency(code);
      if (!currency) throw new Error("Custom currency not found.");
      const next = normalizeCustomCurrencyInput({
        label: patch.label ?? currency.label,
        amountMarker: patch.amountMarker ?? currency.amountMarker,
        scale: patch.scale ?? currency.scale,
      });
      if (!next) throw new Error("Enter valid custom currency details.");

      if (this.isCurrencyUsed(currency.code) && next.scale !== currency.scale) {
        throw new Error("Price format cannot be changed while this currency is used.");
      }
      const preservesLegacyScale =
        !isMvpCurrencyScale(currency.scale) && next.scale === currency.scale;
      if (!preservesLegacyScale && !isMvpCurrencyScale(next.scale)) {
        throw new Error("Price format must use whole numbers or decimals.");
      }

      this.assertUniqueCurrencyDisplay(
        {
          code: currency.code,
          label: next.label,
          amountMarker: next.amountMarker,
          scale: next.scale,
          source: "custom",
        },
        currency.code
      );

      currency.label = next.label;
      currency.amountMarker = next.amountMarker;
      currency.scale = next.scale;

      this.ensureDefaultCurrencyValid();
    }, () => true, true);
  }

  async archiveCustomCurrency(code: string): Promise<void> {
    await this.mutateAndSave(() => {
      const currency = this.findCustomCurrency(code);
      if (!currency) throw new Error("Custom currency not found.");
      currency.isArchived = true;
      this.ensureDefaultCurrencyValid();
      this.pruneUnusedArchivedCustomCurrencies();
    }, () => true, true);
  }

  async deleteCustomCurrency(code: string): Promise<void> {
    await this.mutateAndSave(() => {
      const currency = this.findCustomCurrency(code);
      if (!currency) throw new Error("Custom currency not found.");
      if (this.isCurrencyUsed(currency.code)) {
        currency.isArchived = true;
      } else {
        this.data.customCurrencies = this.data.customCurrencies.filter(
          (item) => normalizeCurrencyCode(item.code) !== normalizeCurrencyCode(currency.code)
        );
      }

      this.ensureDefaultCurrencyValid();
    }, () => true, true);
  }

  isCurrencyUsed(code: string): boolean {
    const normalized = normalizeCurrencyCode(code);
    return this.data.subscriptions.some(
      (item) => normalizeCurrencyCode(item.price.currencyCode) === normalized
    );
  }

  async updateSubscription(
    id: string,
    patch: UpdateSubscriptionInput
  ): Promise<void> {
    let shouldRefreshIcon = false;
    await this.mutateAndSave(() => {
      const item = this.findItem(id);
      if (!item) return false;
      if (
        patch.customBillingPeriodDays !== undefined &&
        !isValidCustomPeriodDays(patch.customBillingPeriodDays)
      ) {
        throw new Error(
          `Custom billing period must be between 1 and ${MAX_CUSTOM_BILLING_PERIOD_DAYS} days.`
        );
      }

      if (typeof patch.name === "string") {
        const name = patch.name.trim();
        if (!name) throw new Error("Subscription name is required.");
        item.name = name;
      }

      const nextCurrency =
        patch.currencyCode?.trim().toUpperCase() ?? item.price.currencyCode;
      if (typeof patch.priceText === "string" || patch.currencyCode) {
        const priceText =
          typeof patch.priceText === "string"
            ? patch.priceText
            : moneyToInputValue(item.price, this.currencyRegistry);
        const money = parseMoneyInput(priceText, nextCurrency, this.currencyRegistry);
        if (!money) throw new Error("Enter a valid price for the selected currency.");
        item.price = money;
      }

      if (patch.billingPeriod) {
        if (!isBillingPeriodValue(patch.billingPeriod)) {
          throw new Error("Select a valid billing period.");
        }
        item.billingPeriod = patch.billingPeriod;
        if (item.billingPeriod === "custom" && !item.customBillingPeriodDays) {
          item.customBillingPeriodDays = DEFAULT_CUSTOM_BILLING_PERIOD_DAYS;
        }
      }

      if (patch.startDate !== undefined) {
        const startDate = patch.startDate.trim()
          ? parseDateOnly(patch.startDate) ?? undefined
          : undefined;
        if (patch.startDate.trim() && !startDate) {
          throw new Error("Select a valid start date.");
        }
        item.startDate = startDate;
      }

      if (patch.customBillingPeriodDays !== undefined) {
        item.customBillingPeriodDays = patch.customBillingPeriodDays;
      }
      if (item.billingPeriod !== "custom") {
        item.customBillingPeriodDays = undefined;
      }

      if (patch.serviceUrl !== undefined) {
        const serviceUrl = normalizeUrlInput(patch.serviceUrl);
        shouldRefreshIcon = serviceUrl !== item.serviceUrl;
        item.serviceUrl = serviceUrl;
        if (shouldRefreshIcon) this.iconService.clearIcon(item);
      }
      if (patch.icon) {
        item.icon = {
          ...item.icon,
          ...patch.icon,
          emoji: patch.icon.emoji?.trim() || undefined,
        };
        if (item.icon.mode !== "auto") {
          this.iconService.clearIcon(item);
        }
        shouldRefreshIcon = item.icon.mode === "auto";
      }

      item.updatedOn = todayLocalDate(this.clock);
      if (patch.serviceUrl !== undefined || patch.icon) this.nextIconRevision(id);
      this.pruneUnusedArchivedCustomCurrencies();
      return true;
    }, (changed) => changed, true);
    if (shouldRefreshIcon) await this.tryEnsureIcon(id);
  }

  async setSubscriptionEnabled(id: string, enabled: boolean): Promise<void> {
    if (this.disposed) return;

    if (enabled) {
      const item = this.findItem(id);
      if (!item) {
        // The record is provisionally absent behind an unresolved delete or restore. The
        // reconciliation enqueues at invocation: its slot runs after that operation
        // settles and before any newer command, and resolves the record there.
        if (this.provisionalAbsences.has(id)) {
          const actionSequence = this.nextGuiActionSequence(id);
          const datasetGeneration = this.datasetGeneration;
          this.absenceReconcileIds.add(id);
          return this.mutateAndSave(() => {
            this.absenceReconcileIds.delete(id);
            if ((this.guiActionSequences.get(id) ?? 0) !== actionSequence) return false;
            if (datasetGeneration !== this.datasetGeneration) return false;
            const queuedItem = this.findItem(id);
            if (!queuedItem || queuedItem.status !== "disabled") return false;
            queuedItem.status = "enabled";
            queuedItem.disabledOn = undefined;
            queuedItem.updatedOn = todayLocalDate(this.clock);
            return true;
          }, (changed) => changed, true).then(() => undefined);
        }
        return;
      }

      // Every enable records its GUI action sequence and reconciles in the queue,
      // even when the record already looks enabled during another save.
      const actionSequence = this.nextGuiActionSequence(id);
      const datasetGeneration = this.datasetGeneration;
      const restoreWindow = this.restoreWindowCapture();
      const supersededIntent = this.clearDisableIntent(id);
      if (supersededIntent) this.notify();

      await this.mutateAndSave(() => {
        if (
          (this.guiActionSequences.get(id) ?? 0) !== actionSequence ||
          datasetGeneration !== this.datasetGeneration
        ) return false;
        // A click during a restore belongs to the replaced dataset: when that
        // restore succeeds the click dies with it; a failed one keeps it.
        if (restoreWindow && this.restoreSettledOk === true && this.restoreSeq === restoreWindow.seq) {
          return false;
        }
        const queuedItem = this.findItem(id);
        if (!queuedItem || queuedItem.status !== "disabled") return false;
        queuedItem.status = "enabled";
        queuedItem.disabledOn = undefined;
        queuedItem.updatedOn = todayLocalDate(this.clock);
        return true;
      }, (changed) => changed, true, () => {
        // A failed enable reinstates the intent it consumed under a fresh monotonic
        // identity, keeping the original deadline; counters are never rewound.
        if (!supersededIntent || this.disposed || this.statusIntents.has(id)) return;
        if ((this.guiActionSequences.get(id) ?? 0) !== actionSequence) return;
        this.scheduleDisableIntent(id, this.nextStatusGeneration(id), supersededIntent.deadline);
      });
      return;
    }

    const item = this.findItem(id);
    if (!item) {
      if (this.provisionalAbsences.has(id)) {
        const actionSequence = this.nextGuiActionSequence(id);
        const datasetGeneration = this.datasetGeneration;
        const deadline = this.clock.now().getTime() + DISABLE_GRACE_PERIOD_MS;
        this.absenceReconcileIds.add(id);
        return this.mutateAndSave(() => {
          this.absenceReconcileIds.delete(id);
          if ((this.guiActionSequences.get(id) ?? 0) !== actionSequence) return false;
          if (datasetGeneration !== this.datasetGeneration) return false;
          if (!this.findItem(id) || this.statusIntents.has(id)) return false;
          // Runtime-only: the pending intent arms at the user's invocation deadline.
          this.scheduleDisableIntent(id, this.nextStatusGeneration(id), deadline);
          this.notify();
          return false;
        }, () => false, true).then(() => undefined);
      }
      return;
    }
    if (this.statusIntents.has(id)) return;

    this.nextGuiActionSequence(id);
    this.scheduleDisableIntent(id, this.nextStatusGeneration(id));
    // Stamped so a successful restore can cancel this intent; a failed restore
    // keeps it against the rolled-back record.
    const restoreWindow = this.restoreWindowCapture();
    if (restoreWindow) {
      this.restoreEra.set(id, restoreWindow.seq);
    }
    this.notify();
  }

  private clearDisableIntent(id: string): StatusIntent | null {
    const intent = this.statusIntents.get(id);
    if (!intent) return null;
    window.clearTimeout(intent.timeoutId);
    this.statusIntents.delete(id);
    this.restoreEra.delete(id);
    return intent;
  }

  private nextStatusGeneration(id: string): number {
    const nextGeneration = (this.statusGenerations.get(id) ?? 0) + 1;
    this.statusGenerations.set(id, nextGeneration);
    return nextGeneration;
  }

  private nextGuiActionSequence(id: string): number {
    const nextSequence = (this.guiActionSequences.get(id) ?? 0) + 1;
    this.guiActionSequences.set(id, nextSequence);
    return nextSequence;
  }

  /** Intents from a replaced dataset are dropped at once; they can never complete. */
  private dropStaleStatusIntents(): void {
    for (const [id, intent] of this.statusIntents) {
      if (intent.datasetGeneration !== this.datasetGeneration) {
        window.clearTimeout(intent.timeoutId);
        this.statusIntents.delete(id);
        this.restoreEra.delete(id);
      }
    }
  }

  private scheduleDisableIntent(id: string, generation: number, deadline?: number, delay?: number): void {
    // Callers guard against a live intent, but a stale timer must never survive
    // an arm; clearing first makes a double-arm impossible by construction.
    this.clearDisableIntent(id);
    const now = this.clock.now().getTime();
    const at = deadline ?? now + DISABLE_GRACE_PERIOD_MS;
    // The intent's deadline is the user's original undo deadline; the timer delay
    // may differ to rate-limit persistence retries without rewriting it.
    const timerDelay = delay ?? Math.max(0, at - now);
    const timeoutId = window.setTimeout(() => {
      this.expireDisableIntent(id, generation);
    }, timerDelay);
    this.statusIntents.set(id, {
      subscriptionId: id,
      generation,
      actionSequence: this.guiActionSequences.get(id) ?? 0,
      datasetGeneration: this.datasetGeneration,
      deadline: at,
      timeoutId,
    });
  }

  /**
   * The intent stays effective until its queued mutation persists, so the timer
   * callback only gates on generation; the mutation always consumes the intent
   * (a stale dataset epoch refuses the work without leaking it) and re-arms with
   * a fresh interval on save failure — rate-limited, never a tight retry loop.
   */
  private expireDisableIntent(id: string, generation: number): void {
    if (this.disposed) return;
    const intent = this.statusIntents.get(id);
    if (
      !intent || intent.generation !== generation ||
      this.statusGenerations.get(id) !== generation
    ) {
      return;
    }
    void this
      .mutateAndSave(() => {
        const current = this.statusIntents.get(id);
        if (
          !current || current.generation !== generation ||
          this.statusGenerations.get(id) !== generation
        ) return false;
        // A successful restore cancels clicks made during it; a failed one keeps
        // them against the rolled-back record.
        const era = this.restoreEra.get(id);
        if (era !== undefined && this.restoreSettledOk === true && this.restoreSeq === era) {
          this.statusIntents.delete(id);
          this.restoreEra.delete(id);
          return false;
        }
        this.statusIntents.delete(id);
        this.restoreEra.delete(id);
        if (current.datasetGeneration !== this.datasetGeneration) return false;
        return this.disableSubscriptionNow(id);
      }, (changed) => changed, true, () => {
        // Rollback runs inside the owning queue slot, before any newer queued
        // command: the intent is reinstated so newer intents always win, and the
        // retry is rate-limited without rewriting the user's original deadline.
        if (this.disposed || this.statusIntents.has(id)) return;
        if ((this.guiActionSequences.get(id) ?? 0) !== intent.actionSequence) return;
        if (intent.datasetGeneration !== this.datasetGeneration) return;
        if (intent.deadline > this.clock.now().getTime()) {
          this.scheduleDisableIntent(id, this.nextStatusGeneration(id), intent.deadline);
        } else {
          this.scheduleDisableIntent(id, this.nextStatusGeneration(id), intent.deadline, DISABLE_GRACE_PERIOD_MS);
        }
      // Exempt from the central disposed policy: the entry guard above already
      // returned when disposed, and a mid-dispose slot must behave as before.
      }, () => undefined)
      .then((changed) => {
        this.saveFailureNoticeShown = false;
        if (!changed && !this.disposed) this.notify();
      })
      .catch((e) => {
        console.error("Failed to save disabled subscription:", e);
        // One notice per failure episode: sustained outages re-fire this retry
        // every ~1.5s, and a notice per attempt would spam the user.
        if (!this.saveFailureNoticeShown) {
          this.saveFailureNoticeShown = true;
          new Notice("Failed to save disabled subscription");
        }
      });
  }

  async deleteSubscription(id: string): Promise<void> {
    let cancelledIntent: StatusIntent | null = null;
    let ownerToken: number | undefined;

    try {
      await this.mutateAndSave(
        () => {
          if (!this.findItem(id)) return false;

          cancelledIntent = this.clearDisableIntent(id);
          ownerToken = ++this.nextProvisionalToken;
          this.provisionalAbsences.set(id, ownerToken);
          this.nextIconRevision(id);
          const item = this.findItem(id);
          if (item) this.iconService.clearIcon(item);
          this.data.subscriptions = this.data.subscriptions.filter((item) => item.id !== id);
          this.pruneUnusedArchivedCustomCurrencies();
          return true;
        },
        (changed) => changed,
        false,
        () => {
          // A pending disable from before the delete is only reinstated when no
          // parked GUI reconciliation is queued for this id; the reconciliation
          // resolves the authoritative record state in its own queue slot.
          if (
            !this.disposed && cancelledIntent && !this.absenceReconcileIds.has(id) &&
            !this.statusIntents.has(id) &&
            this.findItem(id)?.status === "enabled"
          ) {
            this.scheduleDisableIntent(id, this.nextStatusGeneration(id), cancelledIntent.deadline);
          }
        }
      );
      // Deleted ids leave no per-id command metadata behind; a queued same-id
      // reconciliation aborted by this is a no-op either way (the record is gone).
      this.statusGenerations.delete(id);
      this.guiActionSequences.delete(id);
    } catch (error) {
      if (!this.disposed) this.notify();
      throw error;
    } finally {
      // Only the owning execution clears its marker: a newer same-id delete may
      // already have established the next marker before this cleanup resumed.
      if (ownerToken !== undefined && this.provisionalAbsences.get(id) === ownerToken) {
        this.provisionalAbsences.delete(id);
      }
    }
  }

  async refreshIcon(id: string): Promise<boolean> {
    return this.fetchAndCommitIcon(id, false);
  }

  async refreshAllIcons(): Promise<IconRefreshSummary> {
    const batch = await this.enqueueWrite(() => {
      if (this.disposed) throw this.unavailable();
      return {
        epoch: this.iconEpoch,
        items: this.data.subscriptions.map(item => ({
          item: { ...item, icon: { ...item.icon } },
          revision: this.iconRevisions.get(item.id) ?? 0,
        })),
      };
    });
    const summary: IconRefreshSummary = { refreshed: 0, failed: 0, skipped: 0 };
    const requests = new Map<string, IconRequest>();
    for (const { item, revision } of batch.items) {
      if (item.icon.mode !== "auto" || !item.serviceUrl) { summary.skipped++; continue; }
      try {
        if (await this.fetchAndCommitIcon(item.id, false, requests, true, { epoch: batch.epoch, revision })) summary.refreshed++;
        else summary.skipped++;
      } catch (error) {
        console.warn(`Failed to refresh subscription icon for ${item.name}:`, error);
        summary.failed++;
      }
    }
    return summary;
  }
  async clearIcon(id: string): Promise<void> {
    await this.mutateAndSave(() => {
      const item = this.findItem(id);
      if (!item) return false;
      this.nextIconRevision(id);
      this.iconService.clearIcon(item);
      item.updatedOn = todayLocalDate(this.clock);
      return true;
    }, (changed) => changed, true);
  }

  getVisibleSubscriptions(): SubscriptionViewItem[] {
    const viewItems = this.data.subscriptions.map((item) => this.toViewItem(item));
    return sortByName(
      viewItems.filter(
        (item) =>
          item.effectiveStatus === "enabled" || this.data.settings.showDisabled
      )
    );
  }

  getEnabledSubscriptions(): SubscriptionItem[] {
    return sortByName(
      this.data.subscriptions.filter((item) => this.getEffectiveStatus(item) === "enabled")
    );
  }

  getDisabledSubscriptions(): SubscriptionViewItem[] {
    return sortByName(
      this.data.subscriptions
        .map((item) => this.toViewItem(item))
        .filter((item) => item.effectiveStatus === "disabled")
    );
  }

  getTotalsByCurrency(): MoneyTotal[] {
    return calculateTotalsByCurrency(this.getEnabledSubscriptions());
  }

  private async tryEnsureIcon(id: string): Promise<void> {
    try { await this.fetchAndCommitIcon(id, true); }
    catch (error) { console.warn("Failed to fetch subscription icon:", error); }
  }

  private nextIconRevision(id: string): number {
    const revision = (this.iconRevisions.get(id) ?? 0) + 1;
    this.iconRevisions.set(id, revision);
    return revision;
  }

  private async fetchAndCommitIcon(
    id: string,
    ensure: boolean,
    requests?: Map<string, IconRequest>,
    autoOnly = false,
    expected?: { epoch: number; revision: number }
  ): Promise<boolean> {
    const intent = await this.enqueueWrite(() => {
      // Public refreshes are user writes; the internal ensure path stays allowed.
      if (!ensure && !autoOnly && this.disposed) throw this.unavailable();
      const item = this.findItem(id);
      if (expected && (expected.epoch !== this.iconEpoch || expected.revision !== (this.iconRevisions.get(id) ?? 0))) return null;
      if (this.disposed || !item || ((ensure || autoOnly) && item.icon.mode !== "auto") ||
          this.data.settings.faviconProvider === "none" || !getDomainFromUrl(item.serviceUrl)) return null;
      if (ensure && this.iconService.getCachedIcon(item)) return null;
      return {
        item: { ...item, icon: { ...item.icon }, price: { ...item.price } },
        revision: this.nextIconRevision(id), epoch: this.iconEpoch,
        provider: this.data.settings.faviconProvider,
        domainRevision: this.iconDomainRevisions.get(getDomainFromUrl(item.serviceUrl)!) ?? 0,
      };
    });
    if (!intent) return false;
    const domain = getDomainFromUrl(intent.item.serviceUrl)!;
    let domainRevision = intent.domainRevision;
    let cached = ensure ? this.iconService.getReusableIcon(intent.item) : null;
    const reusingCache = cached !== null;
    if (!cached) {
      let request = requests?.get(domain);
      if (!request) {
        request = {
          promise: this.iconService.fetchAutoIcon(intent.item, intent.epoch),
          domainRevision,
        };
        requests?.set(domain, request);
      }
      domainRevision = request.domainRevision;
      try { cached = await request.promise; }
      catch (error) {
        if (autoOnly) throw error;
        console.warn("Failed to fetch subscription icon:", error);
        return false;
      }
    }
    if (!cached) return false;
    const candidate = cached;
    let previousDomainRevision: number | undefined;
    let domainRevisionChanged = false;
    return this.mutateAndSave(() => {
      const current = this.findItem(id);
      // Exempt from the central disposed policy: background icon work is
      // discarded silently after disposal, never surfaced as an error.
      if (this.disposed || !current || this.iconEpoch !== intent.epoch ||
          this.iconRevisions.get(id) !== intent.revision ||
          current.serviceUrl !== intent.item.serviceUrl ||
          current.icon.mode !== intent.item.icon.mode ||
          this.data.settings.faviconProvider !== intent.provider) return false;
      // Another item may have committed newer bytes to this shared domain cache.
      const currentDomainRevision = this.iconDomainRevisions.get(domain) ?? 0;
      const selected = currentDomainRevision === domainRevision
        ? candidate : this.iconService.getReusableIcon(current);
      if (!selected) return false;
      this.iconService.attachIcon(current, selected);
      if (!reusingCache && currentDomainRevision === domainRevision) {
        previousDomainRevision = this.iconDomainRevisions.get(domain);
        this.iconDomainRevisions.set(domain, currentDomainRevision + 1);
        domainRevisionChanged = true;
      }
      current.updatedOn = todayLocalDate(this.clock);
      return true;
    }, (changed) => changed, true, () => {
      if (!domainRevisionChanged) return;
      if (previousDomainRevision === undefined) this.iconDomainRevisions.delete(domain);
      else this.iconDomainRevisions.set(domain, previousDomainRevision);
    }, () => undefined);
  }
  private disableSubscriptionNow(id: string): boolean {
    const current = this.findItem(id);
    if (!current || current.status === "disabled") return false;

    current.status = "disabled";
    current.disabledOn = todayLocalDate(this.clock);
    current.updatedOn = current.disabledOn;
    return true;
  }
}
