import * as internals from "./homeScreenContext.js";
import { startHomeContinueWatchingLoad } from "./homeContinueWatchingLoad.js";
import { HomeCatalogSnapshotStore, buildHomeCatalogSnapshotKey } from "../../../data/local/homeCatalogSnapshotStore.js";

const SNAPSHOT_READ_TIMEOUT_MS = 500;
const SNAPSHOT_WRITE_INTERVAL_MS = 60 * 1000;
const SNAPSHOT_INPUT_IDLE_MS = 1500;
const DEFERRED_ROWS_COALESCE_MS = 180;
const DEFERRED_ROWS_MAX_WAIT_MS = 720;

function readSnapshotWithTimeout(options) {
  let timeoutId = null;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(null), SNAPSHOT_READ_TIMEOUT_MS);
  });
  return Promise.race([HomeCatalogSnapshotStore.read(options).catch(() => null), timeout]).then(
    (value) => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      return value;
    },
    () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      return null;
    }
  );
}

function descriptorCacheKey(descriptor = {}) {
  return [
    String(descriptor?.addonBaseUrl || ""),
    String(descriptor?.addonId || ""),
    String(descriptor?.type || ""),
    String(descriptor?.catalogId || "")
  ].join("\u0000");
}

function persistHomeCatalogSnapshot(screen, token, { force = false, Router = null } = {}) {
  const key = screen?.homeCatalogSnapshotKey;
  if (!key || token !== screen.homeLoadToken) return;
  if (screen.homeCatalogSnapshotWriteTimer) {
    clearTimeout(screen.homeCatalogSnapshotWriteTimer);
    screen.homeCatalogSnapshotWriteTimer = null;
  }
  screen.pendingHomeCatalogSnapshotForce = Boolean(screen.pendingHomeCatalogSnapshotForce || force);
  const now = Date.now();
  const lastInputAt = Number(screen.lastHomeInputAt || 0);
  const idleElapsed = lastInputAt > 0 ? now - lastInputAt : Infinity;
  if (idleElapsed <= SNAPSHOT_INPUT_IDLE_MS) {
    const waitMs = Math.max(50, SNAPSHOT_INPUT_IDLE_MS - idleElapsed + 25);
    screen.homeCatalogSnapshotWriteTimer = setTimeout(() => {
      screen.homeCatalogSnapshotWriteTimer = null;
      if (Router && Router.getCurrent() !== "home") {
        return;
      }
      persistHomeCatalogSnapshot(screen, token, {
        force: Boolean(screen.pendingHomeCatalogSnapshotForce),
        Router
      });
    }, waitMs);
    return;
  }
  const effectiveForce = Boolean(force || screen.pendingHomeCatalogSnapshotForce);
  screen.pendingHomeCatalogSnapshotForce = false;
  if (!effectiveForce && now - Number(screen.lastHomeCatalogSnapshotWriteAt || 0) < SNAPSHOT_WRITE_INTERVAL_MS) {
    return;
  }
  screen.lastHomeCatalogSnapshotWriteAt = now;
  void HomeCatalogSnapshotStore.write({ key, rows: screen.rows }).catch(() => {});
}

export function createHomeScreenMethods21() {
  const {
    Router,
    addonRepository,
    catalogRepository,
    watchProgressRepository,
    watchedItemsRepository,
    LayoutPreferences,
    HomeCatalogStore,
    CollectionsStore,
    ProfileManager,
    StartupSyncService,
    WatchProgressSource,
    buildWatchedTitleIdSet,
    buildCatalogOrderKey,
    catalogShouldShowOnHome,
    catalogSkipStep,
    catalogSupportsExtra,
    selectHomeCatalogDescriptorsToLoad,
    getSidebarProfileState,
    CW_MAX_VISIBLE_ITEMS,
    HOME_ADDON_MANIFEST_TIMEOUT_MS,
    HOME_PERF_DEBUG,
    mergeRefreshedHomeRows,
    shouldApplyLateContinueWatchingFocus,
    homePerfNow,
    logHomePerf,
    uniqueById,
    getContinueWatchingNextUpSeedOptions,
    buildSidebarProfileSignature,
    buildHeroIdentity
  } = internals;

  const loadDeferredCatalogDescriptors = (screen, descriptors = [], { token, routeInputSignature = "", prefetchedResults = null } = {}) => {
    if (!Array.isArray(descriptors) || !descriptors.length) {
      screen.pendingHomeCatalogDescriptors = [];
      return Promise.resolve([]);
    }
    const pendingByKey = new Map();
    descriptors.forEach((descriptor) => {
      pendingByKey.set(descriptorCacheKey(descriptor), descriptor);
    });
    screen.pendingHomeCatalogDescriptors = Array.from(pendingByKey.values());
    screen.homeDeferredLoadInFlightToken = token;

    const pendingRows = new Map();
    const clearFlushTimer = () => {
      if (screen.homeDeferredRowsFlushTimer) {
        clearTimeout(screen.homeDeferredRowsFlushTimer);
        screen.homeDeferredRowsFlushTimer = null;
      }
      screen.homeDeferredRowsFirstQueuedAt = 0;
    };
    const flushDeferredRows = ({ render = true } = {}) => {
      clearFlushTimer();
      if (token !== screen.homeLoadToken || Router.getCurrent() !== "home") {
        pendingRows.clear();
        return;
      }
      if (!pendingRows.size) {
        return;
      }
      const combinedByKey = new Map((screen.rows || []).map((entry) => [entry.homeCatalogKey, entry]));
      pendingRows.forEach((entry, key) => combinedByKey.set(key, entry));
      pendingRows.clear();
      screen.rows = screen.sortAndFilterRows(Array.from(combinedByKey.values()), screen.collections);
      screen.heroCandidates = uniqueById(screen.collectHeroCandidates(screen.rows));
      if (!screen.heroItem) {
        screen.heroItem = screen.pickInitialHero();
      }
      void screen.refreshWatchedTitleState({ token });
      if (render) {
        screen.requestRender();
      }
    };
    const scheduleFlush = () => {
      if (screen.homeDeferredRowsFlushTimer) {
        clearTimeout(screen.homeDeferredRowsFlushTimer);
        screen.homeDeferredRowsFlushTimer = null;
      }
      const now = Date.now();
      if (!screen.homeDeferredRowsFirstQueuedAt) {
        screen.homeDeferredRowsFirstQueuedAt = now;
      }
      const elapsed = now - screen.homeDeferredRowsFirstQueuedAt;
      const delayMs = elapsed >= DEFERRED_ROWS_MAX_WAIT_MS ? 0 : Math.min(DEFERRED_ROWS_COALESCE_MS, DEFERRED_ROWS_MAX_WAIT_MS - elapsed);
      screen.homeDeferredRowsFlushTimer = setTimeout(() => {
        flushDeferredRows({ render: true });
      }, delayMs);
    };

    return screen
      .fetchCatalogRows(descriptors, {
        allowLoading: true,
        prefetchedResults,
        batchSize: screen.getDeferredCatalogBatchSize(),
        onRow: (row) => {
          if (token !== screen.homeLoadToken || Router.getCurrent() !== "home") {
            return;
          }
          pendingByKey.delete(descriptorCacheKey(row));
          screen.pendingHomeCatalogDescriptors = Array.from(pendingByKey.values());
          pendingRows.set(row.homeCatalogKey, row);
          scheduleFlush();
        }
      })
      .then((extraRows) => {
        clearFlushTimer();
        if (token !== screen.homeLoadToken || Router.getCurrent() !== "home") {
          return extraRows;
        }
        screen.pendingHomeCatalogDescriptors = [];
        if (routeInputSignature) {
          screen.loadedHomeRouteInputSignature = routeInputSignature;
        }
        const combinedByKey = new Map((screen.rows || []).map((entry) => [entry.homeCatalogKey, entry]));
        pendingRows.forEach((entry, key) => combinedByKey.set(key, entry));
        pendingRows.clear();
        (Array.isArray(extraRows) ? extraRows : []).forEach((row) => {
          combinedByKey.set(row.homeCatalogKey, row);
        });
        screen.rows = screen.sortAndFilterRows(Array.from(combinedByKey.values()), screen.collections);
        screen.heroCandidates = uniqueById(screen.collectHeroCandidates(screen.rows));
        if (!screen.heroItem) {
          screen.heroItem = screen.pickInitialHero();
        }
        void screen.refreshWatchedTitleState({ token });
        persistHomeCatalogSnapshot(screen, token, { force: true, Router });
        screen.requestBackgroundRender();
        screen.retryPendingCatalogRows();
        return extraRows;
      })
      .catch((error) => {
        clearFlushTimer();
        console.warn("Deferred home rows load failed", error);
        return [];
      })
      .finally(() => {
        if (screen.homeDeferredLoadInFlightToken === token) {
          screen.homeDeferredLoadInFlightToken = null;
        }
      });
  };

  return {
    resumePendingHomeCatalogDescriptors({ token = this.homeLoadToken, routeInputSignature = "" } = {}) {
      if (
        token !== this.homeLoadToken ||
        Router.getCurrent() !== "home" ||
        !Array.isArray(this.pendingHomeCatalogDescriptors) ||
        !this.pendingHomeCatalogDescriptors.length ||
        this.homeDeferredLoadInFlightToken === token
      ) {
        return Promise.resolve([]);
      }
      return loadDeferredCatalogDescriptors(this, this.pendingHomeCatalogDescriptors.slice(), {
        token,
        routeInputSignature: routeInputSignature || this.loadedHomeRouteInputSignature
      });
    },
    async loadData({ background = false, preserveReturnState = false, refreshManifests = true } = {}) {
      const loadStart = HOME_PERF_DEBUG ? homePerfNow() : 0;
      const token = this.homeLoadToken;
      if (!background) {
        this.loadedHomeRouteInputSignature = "";
        this.pendingHomeCatalogDescriptors = [];
      }
      const preserveHomeReturnState = Boolean(background && preserveReturnState);
      const preservedHeroItem = preserveHomeReturnState ? this.heroItem : null;
      const preservedHeroIdentity = preserveHomeReturnState ? buildHeroIdentity(this.heroItem) : "";
      const prefs = LayoutPreferences.get();
      this.layoutPrefs = prefs;
      this.renderedSyncSensitiveSignature = this.buildSyncSensitiveHomeSignature();
      // Async catalog/progress refreshes must not collapse a focused sidebar.
      // Android keeps this presentation state outside the Home data flow.
      this.sidebarExpanded = Boolean(this.sidebarExpanded);
      this.layoutMode = String(prefs.homeLayout || "classic").toLowerCase();
      const nextUpSeedOptions = getContinueWatchingNextUpSeedOptions();
      const watchedItemsPromise = watchedItemsRepository.getAll(2000).catch(() => []);
      watchedItemsPromise.then((watchedItems) => {
        if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
          return;
        }
        this.watchedItems = Array.isArray(watchedItems) ? watchedItems : [];
        this.watchedTitleIds = buildWatchedTitleIdSet(this.watchedItems);
        if (!this.isInitialHomeLoading) {
          this.requestBackgroundRender();
        }
        void this.refreshWatchedTitleState({ token });
      });

      const continueWatchingSourceKey = watchProgressRepository.getContinueWatchingSourceKey();
      const continueWatchingSource = watchProgressRepository.getContinueWatchingSource();
      const startupSyncPendingAtLoad =
        continueWatchingSource === WatchProgressSource.NUVIO_SYNC && StartupSyncService.isCurrentProfilePullPending();
      const startupSyncPullPromiseAtLoad = startupSyncPendingAtLoad ? StartupSyncService.getCurrentProfilePullPromise() : null;
      const preserveContinueWatching = Boolean(background && this.continueWatchingDisplay?.length);
      const hydratedFromSnapshot = Boolean(
        !background && this.continueWatchingHydratedFromSnapshot && this.continueWatchingDisplay?.length
      );
      const hasExistingContinueWatchingDisplay = Boolean(
        (preserveContinueWatching || hydratedFromSnapshot) && this.continueWatchingDisplay?.length
      );
      const suppressContinueWatchingLoading = preserveContinueWatching || hydratedFromSnapshot;
      const progressErrors = { all: null, recent: null };
      const sidebarProfilePromise = getSidebarProfileState().catch(() => null);
      const progressAllPromise = watchProgressRepository.getAllForContinueWatching().catch((error) => {
        progressErrors.all = error;
        return [];
      });
      const recentProgressPromise = watchProgressRepository.getRecent(CW_MAX_VISIBLE_ITEMS, { enrichMetadata: false }).catch((error) => {
        progressErrors.recent = error;
        return [];
      });
      // Continue Watching is reconciled fire-and-forget in the block below, so a
      // slow addon or Trakt call never blocks catalog rows. The section paints
      // from the cached snapshot when available, or raw progress before enrichment.

      startHomeContinueWatchingLoad.call(this, {
        token,
        watchedItemsPromise,
        progressAllPromise,
        recentProgressPromise,
        progressErrors,
        continueWatchingSourceKey,
        continueWatchingSource,
        startupSyncPendingAtLoad,
        startupSyncPullPromiseAtLoad,
        nextUpSeedOptions,
        prefs,
        background,
        preserveHomeReturnState,
        suppressContinueWatchingLoading,
        hasExistingContinueWatchingDisplay
      });

      const addons = refreshManifests
        ? await addonRepository.getInstalledAddons({
            includeMediaServers: true,
            staleWhileRevalidate: true,
            timeoutMs: HOME_ADDON_MANIFEST_TIMEOUT_MS
          })
        : await addonRepository.getInstalledAddons({ cacheOnly: true });
      this.collections = CollectionsStore.get();
      const catalogDescriptors = [];

      addons.forEach((addon) => {
        addon.catalogs
          .filter((catalog) => catalogShouldShowOnHome(catalog))
          .forEach((catalog) => {
            catalogDescriptors.push({
              addonBaseUrl: addon.baseUrl,
              addonId: addon.id,
              addonName: addon.displayName,
              catalogId: catalog.id,
              catalogName: catalog.name,
              type: catalog.apiType,
              supportsSkip: catalogSupportsExtra(catalog, "skip"),
              skipStep: catalogSkipStep(catalog)
            });
          });
      });

      // Installed-addon state can contain the same manifest catalog more than
      // once. Collapse only descriptors that would issue the exact same request;
      // addons that reuse ids on different base URLs must retain the existing
      // last-row-wins behavior.
      const seenCatalogDescriptors = new Set();
      const uniqueCatalogDescriptors = catalogDescriptors.filter((descriptor) => {
        const descriptorKey = JSON.stringify([
          descriptor?.addonBaseUrl || "",
          descriptor?.addonId || "",
          descriptor?.addonName || "",
          descriptor?.catalogId || "",
          descriptor?.catalogName || "",
          descriptor?.type || ""
        ]);
        if (seenCatalogDescriptors.has(descriptorKey)) {
          return false;
        }
        seenCatalogDescriptors.add(descriptorKey);
        return true;
      });
      if (HOME_PERF_DEBUG) {
        logHomePerf("catalogDescriptors", {
          requested: catalogDescriptors.length,
          unique: uniqueCatalogDescriptors.length,
          duplicates: catalogDescriptors.length - uniqueCatalogDescriptors.length
        });
      }

      // Seed missing order keys from manifest order before progressive requests
      // can add rows in network-completion order.
      HomeCatalogStore.ensureOrderKeys(
        uniqueCatalogDescriptors.map((catalog) => buildCatalogOrderKey(catalog.addonId, catalog.type, catalog.catalogId))
      );
      const routeInputSignature = this.buildHomeRouteInputSignature(addons);
      const homeCatalogSnapshotKey = buildHomeCatalogSnapshotKey({
        profileId: ProfileManager.getActiveProfileId(),
        addonDescriptors: uniqueCatalogDescriptors,
        homeCatalogPrefs: HomeCatalogStore.get()
      });
      this.homeCatalogSnapshotKey = homeCatalogSnapshotKey;

      // Disabled rows are dropped by sortAndFilterRows anyway. Skip them here
      // and follow the saved Home order, so the first batch holds the rows the
      // user sees first.
      const homeCatalogDescriptors = selectHomeCatalogDescriptorsToLoad(uniqueCatalogDescriptors, HomeCatalogStore.get());
      const initialCatalogLoad = this.getInitialCatalogLoadCount();
      const initialDescriptors = homeCatalogDescriptors.slice(0, initialCatalogLoad);
      const deferredDescriptors = homeCatalogDescriptors.slice(initialCatalogLoad);

      const progressiveInitialRows = new Map();
      const initialRowsPromise = this.fetchCatalogRows(initialDescriptors, {
        allowLoading: true,
        onRow: (row) => {
          if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
            return;
          }
          // Progressive first paint exists for a cold load with nothing on screen.
          // During a background refresh a full Home is already rendered, so
          // painting one-to-six rows over it is a regression, not progress.
          if (background) {
            return;
          }
          progressiveInitialRows.set(row.homeCatalogKey, row);
          // Merge with anything already on screen (a disk snapshot or a
          // previous row) instead of replacing it with the first network row.
          const combinedByKey = new Map((this.rows || []).map((entry) => [entry.homeCatalogKey, entry]));
          progressiveInitialRows.forEach((entry, key) => combinedByKey.set(key, entry));
          this.rows = this.sortAndFilterRows(Array.from(combinedByKey.values()), this.collections);
          this.heroCandidates = uniqueById(this.collectHeroCandidates(this.rows));
          if (!this.heroItem) {
            this.heroItem = this.pickInitialHero();
          }
          this.releaseInitialHomeLoading();
          this.hasLoadedOnce = true;
          this.requestBackgroundRender();
          this.maybeStartPendingHomeBackgroundRefresh();
        }
      });
      if (!background && !this.hasLoadedOnce) {
        // Read the last successful catalog in parallel with the network. If
        // the addons answer first, the progressive rows above already won and
        // this snapshot is ignored; if the disk answers first, Home paints
        // while the same network refresh continues.
        const cachedRows = await Promise.race([
          readSnapshotWithTimeout({ key: homeCatalogSnapshotKey }),
          initialRowsPromise.then(() => null).catch(() => null)
        ]);
        if (cachedRows?.length && token === this.homeLoadToken && Router.getCurrent() === "home" && !this.hasLoadedOnce) {
          this.loadedProfileId = String(ProfileManager.getActiveProfileId() || "");
          this.rows = this.sortAndFilterRows(cachedRows, this.collections);
          this.heroCandidates = uniqueById(this.collectHeroCandidates(this.rows));
          this.heroItem = this.pickInitialHero();
          this.releaseInitialHomeLoading();
          this.hasLoadedOnce = true;
          if (this.container?.querySelector(".home-shell")) {
            this.requestRender();
          } else {
            this.render();
          }
        }
      }
      // Start the visible rows first. Overlap one deferred batch only on a
      // foreground load where the runtime can afford the extra requests.
      // Keep the actual promises: the repository caches completed results only,
      // so a second request while prefetch is pending would duplicate the work.
      const prefetchedResults = new Map();
      if (!background && !this.isPerformanceConstrained() && !this.isLegacyTvRuntime()) {
        const prefetchCount = Math.min(8, Math.max(0, this.getDeferredCatalogBatchSize()));
        deferredDescriptors.slice(0, prefetchCount).forEach((catalog) => {
          prefetchedResults.set(
            catalog,
            catalogRepository.getCatalog({
              addonBaseUrl: catalog.addonBaseUrl,
              addonId: catalog.addonId,
              addonName: catalog.addonName,
              catalogId: catalog.catalogId,
              catalogName: catalog.catalogName,
              type: catalog.type,
              skip: 0,
              skipStep: catalog.skipStep,
              supportsSkip: catalog.supportsSkip !== false
            })
          );
        });
        void Promise.allSettled(prefetchedResults.values());
      }
      const initialRows = await initialRowsPromise;
      if (token !== this.homeLoadToken) {
        return;
      }
      if (initialDescriptors.length) {
        // Match Android's catalog freshness window from the last page-one
        // request. A later no-op sync can refresh these rows in place without
        // rebuilding Continue Watching, the hero, or the Home shell.
        this.lastHomeCatalogRefreshAtMs = Date.now();
      }
      // A background refresh resolves only the initial catalog batch first, so
      // assigning it directly discards every already-rendered row outside that
      // batch. Merge the configured rows and let fresh data replace duplicates.
      const configuredCatalogKeys = new Set(
        uniqueCatalogDescriptors.map((catalog) => buildCatalogOrderKey(catalog.addonId, catalog.type, catalog.catalogId))
      );
      const nextInitialRows = mergeRefreshedHomeRows(this.rows, initialRows, configuredCatalogKeys, {
        background
      });
      this.rows = this.sortAndFilterRows(nextInitialRows, this.collections);
      persistHomeCatalogSnapshot(this, token, { Router });
      if (preserveContinueWatching) {
        this.continueWatchingLoading = false;
      } else if (
        !background &&
        this.layoutMode === "modern" &&
        this.layoutPrefs?.continueWatchingEnabled !== false &&
        this.continueWatchingHydratedFromSnapshot &&
        this.continueWatchingDisplay?.length
      ) {
        // CW already painted instantly from the snapshot — focus it on this render.
        // Fresh data reconciles fire-and-forget below.
        if (
          shouldApplyLateContinueWatchingFocus({
            background,
            hasUserInteracted: this.hasUserInteractedSinceHomePaint,
            suppressInitialFocus: this.suppressInitialContinueWatchingFocus,
            hasAppliedInitialFocus: this.hasAppliedInitialContinueWatchingFocus
          })
        ) {
          this.forceInitialContinueWatchingFocus = true;
        }
      }
      this.heroCandidates = uniqueById(this.collectHeroCandidates(this.rows));
      if (preserveHomeReturnState) {
        const currentHeroIdentity = buildHeroIdentity(this.heroItem);
        const shouldRestorePreservedHero =
          Boolean(preservedHeroItem) && (!preservedHeroIdentity || currentHeroIdentity === preservedHeroIdentity);
        if (shouldRestorePreservedHero) {
          this.heroItem = preservedHeroItem;
        } else if (!this.heroItem) {
          this.heroItem = this.pickInitialHero();
        }
        const heroIdentity = buildHeroIdentity(this.heroItem);
        const matchedHeroIndex = this.heroCandidates.findIndex((candidate) => buildHeroIdentity(candidate) === heroIdentity);
        if (matchedHeroIndex >= 0) {
          this.heroIndex = matchedHeroIndex;
        }
      } else if (!this.hasUserInteractedSinceHomePaint) {
        this.heroIndex = 0;
        this.heroItem = this.pickInitialHero();
      }
      this.loadedProfileId = String(ProfileManager.getActiveProfileId() || "");
      this.loadedWatchProgressSourceKey = watchProgressRepository.getContinueWatchingSourceKey();
      this.releaseInitialHomeLoading();
      this.hasLoadedOnce = true;
      this.loadedHomeRouteInputSignature = routeInputSignature;
      this.pendingHomeCatalogDescriptors = deferredDescriptors.slice();
      if (this.container?.querySelector(".home-shell")) {
        this.requestRender();
      } else {
        this.render();
      }
      this.maybeStartPendingHomeBackgroundRefresh();
      logHomePerf("loadData", {
        phase: "first-render",
        ms: Number((homePerfNow() - loadStart).toFixed(2)),
        background: Boolean(background),
        rows: Number(this.rows?.length || 0),
        continueWatching: Number(this.continueWatchingDisplay?.length || 0),
        nextUpCandidates: Number(this.nextUpProgressCandidates?.length || 0),
        layoutMode: this.layoutMode
      });
      const previousSidebarProfileSignature = buildSidebarProfileSignature(this.sidebarProfile);
      sidebarProfilePromise.then((profile) => {
        if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
          return;
        }
        if (profile && buildSidebarProfileSignature(profile) !== previousSidebarProfileSignature) {
          this.sidebarProfile = profile;
          this.requestBackgroundRender();
        }
      });

      if (deferredDescriptors.length) {
        void loadDeferredCatalogDescriptors(this, deferredDescriptors, {
          token,
          routeInputSignature,
          prefetchedResults
        });
      }

      if (this.layoutMode !== "modern") {
        this.enrichHero(this.heroCandidates[0] || null)
          .then(() => {
            if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
              return;
            }
            this.applyHeroToDom();
          })
          .catch((error) => {
            console.warn("Hero async enrichment failed", error);
          });
      }

      this.retryPendingCatalogRows();
    }
  };
}
