import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

const SCREEN_SAVER_OFF = 0;
const SCREEN_SAVER_ON = 1;

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) {
        listeners.set(type, []);
      }
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      const list = listeners.get(type);
      if (!list) return;
      const next = list.filter((entry) => entry !== listener);
      if (next.length) {
        listeners.set(type, next);
      } else {
        listeners.delete(type);
      }
    },
    dispatchEvent(event) {
      const type = typeof event === "string" ? event : event?.type;
      const payload = typeof event === "string" ? { type } : event;
      for (const listener of [...(listeners.get(type) || [])]) {
        listener(payload);
      }
      return !payload?.defaultPrevented;
    },
    listenerCount(type) {
      return (listeners.get(type) || []).length;
    }
  };
}

function createMockVideo() {
  const target = createEventTarget();
  return {
    ...target,
    src: "",
    currentSrc: "",
    paused: true,
    ended: false,
    readyState: 4,
    currentTime: 0,
    duration: 1200,
    muted: false,
    defaultMuted: false,
    volume: 1,
    playbackRate: 1,
    setAttribute() {},
    removeAttribute(name) {
      if (name === "src") {
        this.src = "";
        this.currentSrc = "";
      }
    },
    querySelectorAll() {
      return [];
    },
    appendChild() {},
    load() {},
    pause() {
      this.paused = true;
    },
    play() {
      this.paused = false;
      return Promise.resolve();
    }
  };
}

function createEnvironment() {
  const storage = new Map();
  const docTarget = createEventTarget();
  const winTarget = createEventTarget();
  const video = createMockVideo();
  const screenSaverCalls = [];
  const webosWindowCalls = [];

  const document = {
    ...docTarget,
    hidden: false,
    visibilityState: "visible",
    activeElement: null,
    documentElement: { clientWidth: 1920, clientHeight: 1080 },
    body: {
      appendChild() {},
      removeChild() {}
    },
    getElementById(id) {
      return id === "videoPlayer" ? video : null;
    },
    createElement() {
      return {
        style: {},
        setAttribute() {},
        appendChild() {},
        remove() {}
      };
    },
    createDocumentFragment() {
      return createEventTarget();
    }
  };

  const window = {
    ...winTarget,
    innerWidth: 1920,
    innerHeight: 1080,
    history: {
      state: null,
      replaceState() {},
      pushState() {},
      go() {}
    }
  };

  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
  };
  globalThis.document = document;
  globalThis.window = window;
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail ?? null;
      this.cancelable = Boolean(init.cancelable);
      this.defaultPrevented = false;
    }
    preventDefault() {
      if (this.cancelable) {
        this.defaultPrevented = true;
      }
    }
  };
  globalThis.Event = class Event {
    constructor(type) {
      this.type = type;
    }
  };
  globalThis.webapis = {
    appcommon: {
      AppCommonScreenSaverState: {
        SCREEN_SAVER_OFF,
        SCREEN_SAVER_ON
      },
      setScreenSaver(state) {
        screenSaverCalls.push(state);
      }
    }
  };
  globalThis.webOSSystem = {
    setWindowProperty(name, value) {
      if (name === "blockScreenSaver") {
        webosWindowCalls.push(value);
      }
    }
  };

  return { document, window, video, screenSaverCalls, webosWindowCalls, storage };
}

let env = createEnvironment();
globalThis.__NUVIO_PLATFORM__ = "tizen";

const [
  { Platform },
  { Router },
  { AmbientMode },
  { PlayerController },
  { TizenScreenSaver },
  { WebOSPlayerExtensions }
] = await Promise.all([
  import("../index.js"),
  import("../../ui/navigation/routerState.js"),
  import("../../ui/ambient/ambientMode.js"),
  import("../../core/player/playerController.js"),
  import("./tizenScreenSaver.js"),
  import("../webos/webosPlayerExtensions.js")
]);
const internals = await import("../../core/player/playerController.js");

internals.watchProgressRepository.saveProgress = async () => {};
internals.watchedItemsRepository.mark = async () => {};

let avplayInstance = null;

function createMockAvPlay(overrides = {}) {
  let state = "IDLE";
  const listeners = {};
  return {
    listeners,
    openCalls: [],
    playCalls: 0,
    pauseCalls: 0,
    stopCalls: 0,
    closeCalls: 0,
    open(url) {
      this.openCalls.push(url);
      state = "IDLE";
    },
    setListener(next) {
      Object.assign(listeners, next || {});
    },
    setDisplayRect() {},
    setDisplayMethod() {},
    setStreamingProperty() {},
    setSilentSubtitle() {},
    getState() {
      return state;
    },
    setState(nextState) {
      state = nextState;
    },
    prepareAsync(onPrepared, onError) {
      this._onPrepared = onPrepared;
      this._onPrepareError = onError;
    },
    play() {
      this.playCalls += 1;
      state = "PLAYING";
    },
    pause() {
      this.pauseCalls += 1;
      state = "PAUSED";
    },
    stop() {
      this.stopCalls += 1;
      state = "IDLE";
    },
    close() {
      this.closeCalls += 1;
      state = "NONE";
    },
    getCurrentTime() {
      return 12000;
    },
    getDuration() {
      return 1200000;
    },
    getTotalTrackInfo() {
      return [];
    },
    getCurrentStreamInfo() {
      return [];
    },
    ...overrides
  };
}

function resetPlayerControllerState(video) {
  PlayerController.video = video;
  PlayerController.isPlaying = false;
  PlayerController.playbackBuffering = false;
  PlayerController.playbackPaused = false;
  PlayerController.suppressedNativePauseEvents = 0;
  PlayerController.suppressedUnpausedNativePause = false;
  PlayerController.playbackSessionActive = false;
  PlayerController.playbackEngine = "none";
  PlayerController.currentPlaybackIsLive = false;
  PlayerController.avplayActive = false;
  PlayerController.avplayReady = false;
  PlayerController.avplayEnded = false;
  PlayerController.avplayBufferingStartedAt = 0;
  PlayerController.avplaySeekInFlight = false;
  PlayerController.startupAudioGateActive = false;
  PlayerController.tizenDtsAudioState = null;
  PlayerController.currentItemId = null;
  PlayerController.playRequestToken = Number(PlayerController.playRequestToken || 0) + 1;
  PlayerController.stopProgressSaving();
  PlayerController.cancelProgressSyncAfterSeek();
  PlayerController.stopAvPlayTickTimer();
  PlayerController.clearAvPlayPreparedPoll();
  PlayerController.clearAvPlaySeekTimeout();
}

function setupControllerWithMockVideo() {
  resetPlayerControllerState(env.video);
  PlayerController.lifecycleBound = false;
  PlayerController.init();
  PlayerController.getAvPlay = () => avplayInstance;
  PlayerController.canUseAvPlay = () => Boolean(avplayInstance);
}

let testCounter = 0;
async function loadIsolatedTizenScreenSaver() {
  testCounter += 1;
  const mod = await import(`./tizenScreenSaver.js?isolated=${testCounter}`);
  return mod.TizenScreenSaver;
}

beforeEach(() => {
  env = createEnvironment();
  avplayInstance = null;
  globalThis.__NUVIO_PLATFORM__ = "tizen";
  Platform.current = null;
  Router.current = "home";
  Router.getCurrent = () => Router.current;
  Router.getCurrentScreen = () => null;
  AmbientMode.exiting = false;
  AmbientMode.showing = false;
  AmbientMode.started = false;
  if (AmbientMode.interval) {
    clearInterval(AmbientMode.interval);
    AmbientMode.interval = null;
  }
  clearTimeout(AmbientMode.preload);
  clearTimeout(AmbientMode.slideTimer);
  clearTimeout(AmbientMode.paintTimer);
});

afterEach(async () => {
  if (AmbientMode.interval) {
    clearInterval(AmbientMode.interval);
    AmbientMode.interval = null;
  }
  clearTimeout(AmbientMode.preload);
  clearTimeout(AmbientMode.slideTimer);
  clearTimeout(AmbientMode.paintTimer);
  if (PlayerController.playbackSessionActive) {
    await PlayerController.stop({ flushProgress: false });
  }
  TizenScreenSaver.unblock("ambient-mode");
  TizenScreenSaver.unblock("player-session");
  PlayerController.stopProgressSaving();
  PlayerController.stopAvPlayTickTimer();
  PlayerController.clearAvPlayPreparedPoll();
  PlayerController.clearAvPlaySeekTimeout();
  WebOSPlayerExtensions.stopPlaybackKeepAwake();
  WebOSPlayerExtensions.stopAmbientKeepAwake();
});

test("TizenScreenSaver tracks independent reasons without overwriting each other and swaps document cleanly", async () => {
  const screenSaver = await loadIsolatedTizenScreenSaver();

  screenSaver.block("ambient-mode");
  screenSaver.block("player-session");
  assert.deepEqual(
    env.screenSaverCalls,
    [SCREEN_SAVER_OFF],
    "adding second reason must keep screensaver disabled without redundant calls"
  );

  screenSaver.unblock("ambient-mode");
  assert.deepEqual(
    env.screenSaverCalls,
    [SCREEN_SAVER_OFF],
    "releasing ambient-mode must not re-enable screensaver while player-session is active"
  );

  screenSaver.unblock("player-session");
  assert.deepEqual(
    env.screenSaverCalls,
    [SCREEN_SAVER_OFF, SCREEN_SAVER_ON],
    "releasing last active reason must re-enable screensaver"
  );

  // Releasing player-session when ambient-mode never blocked must still restore SCREEN_SAVER_ON.
  env.screenSaverCalls.length = 0;
  screenSaver.block("player-session");
  screenSaver.unblock("player-session");
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF, SCREEN_SAVER_ON]);

  // Swapping globalThis.document binds nuvio:beforeExitApp onto the new document.
  const swappedDoc = createEventTarget();
  globalThis.document = swappedDoc;
  env.screenSaverCalls.length = 0;
  screenSaver.block("player-session");
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF]);
  swappedDoc.dispatchEvent(new globalThis.CustomEvent("nuvio:beforeExitApp"));
  screenSaver.unblock("player-session");
  assert.deepEqual(
    env.screenSaverCalls,
    [SCREEN_SAVER_OFF],
    "nuvio:beforeExitApp on swapped document must suppress SCREEN_SAVER_ON"
  );
});

test("AmbientMode preserves 10s Home deferral and does not clobber player-session on player route", () => {
  const originalPerf = globalThis.performance;
  let nowMs = 0;
  globalThis.performance = { now: () => nowMs };

  try {
    AmbientMode.idleRoute = "home";
    AmbientMode.trailerPlaying = false;
    AmbientMode.lastInteraction = 0;
    Router.current = "home";
    nowMs = 9999;
    AmbientMode.tick();
    assert.deepEqual(
      env.screenSaverCalls,
      [],
      "Home idle below 10s must defer AppCommon setScreenSaver call"
    );

    nowMs = 10000;
    AmbientMode.tick();
    assert.deepEqual(
      env.screenSaverCalls,
      [SCREEN_SAVER_OFF],
      "Home idle at 10s must block screensaver for ambient-mode"
    );

    // Player route: AmbientMode ticks every second and clears ambient-mode,
    // which must not drop an active player-session lock.
    TizenScreenSaver.block("player-session");
    Router.current = "player";
    AmbientMode.tick();
    AmbientMode.tick();
    assert.deepEqual(
      env.screenSaverCalls,
      [SCREEN_SAVER_OFF],
      "AmbientMode.tick() on player route must not unblock player-session"
    );

    TizenScreenSaver.unblock("player-session");
    assert.deepEqual(
      env.screenSaverCalls,
      [SCREEN_SAVER_OFF, SCREEN_SAVER_ON],
      "ending player-session after AmbientMode already cleared ambient-mode must restore SCREEN_SAVER_ON"
    );
  } finally {
    globalThis.performance = originalPerf;
  }
});

test("PlayerController AVPlay buffering, startup gate, DTS prepare, pause, resume, stream completion, and stop drive TizenScreenSaver", async () => {
  avplayInstance = createMockAvPlay();
  setupControllerWithMockVideo();

  // Start AVPlay playback while Home never blocked AmbientMode.
  await PlayerController.play("http://127.0.0.1:18080/movie.mkv", {
    itemId: "tt-avplay-1",
    forceEngine: "tizen-avplay"
  });
  assert.deepEqual(
    env.screenSaverCalls,
    [SCREEN_SAVER_OFF],
    "playWithAvPlay() startup buffering must block Tizen screensaver"
  );

  // AmbientMode 1s tick on player route must not unblock player-session.
  Router.current = "player";
  AmbientMode.tick();
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF]);

  // Preparation finishes and playback starts.
  avplayInstance._onPrepared();
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF]);

  // Mid-stream rebuffering keeps SCREEN_SAVER_OFF.
  avplayInstance.listeners.onbufferingstart();
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF]);
  avplayInstance.listeners.onbufferingcomplete();
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF]);

  // Startup audio gate sets isPlaying = false while buffering; must stay SCREEN_SAVER_OFF.
  PlayerController.setStartupAudioGate(true);
  assert.equal(PlayerController.isPlaying, false);
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF]);
  PlayerController.setStartupAudioGate(false, { resume: true });
  assert.equal(PlayerController.isPlaying, true);
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF]);

  // DTS audio preparation keeps SCREEN_SAVER_OFF while playing, and user pause
  // while avplayBufferingStartedAt / startupAudioGateActive / tizenDtsAudioState.preparing
  // are active MUST still clear player-session and invoke SCREEN_SAVER_ON.
  avplayInstance.listeners.onbufferingstart();
  PlayerController.startupAudioGateActive = true;
  PlayerController.tizenDtsAudioState = { preparing: true, cancelled: false, fallingBack: false };
  PlayerController.syncPlaybackKeepAwake?.();
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF]);

  PlayerController.pause();
  assert.equal(PlayerController.isPlaying, false);
  assert.deepEqual(
    env.screenSaverCalls,
    [SCREEN_SAVER_OFF, SCREEN_SAVER_ON],
    "pause() must restore SCREEN_SAVER_ON even if buffering/gate/DTS prepare flags were active"
  );

  // Clear temporary test flags and resume -> SCREEN_SAVER_OFF.
  PlayerController.startupAudioGateActive = false;
  PlayerController.tizenDtsAudioState = null;
  PlayerController.resume();
  assert.equal(PlayerController.isPlaying, true);
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF, SCREEN_SAVER_ON, SCREEN_SAVER_OFF]);

  // Natural VOD stream completion -> SCREEN_SAVER_ON.
  avplayInstance.listeners.onstreamcompleted();
  assert.equal(PlayerController.isPlaying, false);
  assert.deepEqual(env.screenSaverCalls, [
    SCREEN_SAVER_OFF,
    SCREEN_SAVER_ON,
    SCREEN_SAVER_OFF,
    SCREEN_SAVER_ON
  ]);

  await PlayerController.stop({ flushProgress: false });
  assert.deepEqual(env.screenSaverCalls, [
    SCREEN_SAVER_OFF,
    SCREEN_SAVER_ON,
    SCREEN_SAVER_OFF,
    SCREEN_SAVER_ON
  ]);
});

test("PlayerController AVPlay error, onPrepareError, and seek timeout restore SCREEN_SAVER_ON", async () => {
  // 1. onerror
  avplayInstance = createMockAvPlay();
  setupControllerWithMockVideo();
  await PlayerController.play("http://127.0.0.1:18080/movie.mkv", {
    itemId: "tt-err-1",
    forceEngine: "tizen-avplay"
  });
  avplayInstance._onPrepared();
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF]);
  avplayInstance.listeners.onerror("PLAYER_ERROR_CONNECTION_FAILED");
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF, SCREEN_SAVER_ON]);
  await PlayerController.stop({ flushProgress: false });

  // 2. onPrepareError
  env.screenSaverCalls.length = 0;
  avplayInstance = createMockAvPlay();
  setupControllerWithMockVideo();
  await PlayerController.play("http://127.0.0.1:18080/movie.mkv", {
    itemId: "tt-err-2",
    forceEngine: "tizen-avplay"
  });
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF]);
  avplayInstance._onPrepareError("PLAYER_ERROR_NOT_SUPPORTED_FILE");
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF, SCREEN_SAVER_ON]);
  await PlayerController.stop({ flushProgress: false });

  // 3. seek timeout
  env.screenSaverCalls.length = 0;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const pendingTimeouts = [];
  let nextTimeoutId = 1;
  globalThis.setTimeout = (fn, ms) => {
    const id = nextTimeoutId++;
    pendingTimeouts.push({ id, fn, ms });
    return id;
  };
  globalThis.clearTimeout = (id) => {
    const idx = pendingTimeouts.findIndex((entry) => entry.id === id);
    if (idx >= 0) pendingTimeouts.splice(idx, 1);
  };

  try {
    avplayInstance = createMockAvPlay({
      seekTo() {}
    });
    setupControllerWithMockVideo();
    await PlayerController.play("http://127.0.0.1:18080/movie.mkv", {
      itemId: "tt-err-3",
      forceEngine: "tizen-avplay"
    });
    avplayInstance._onPrepared();
    assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF]);
    PlayerController.seekAvPlayTo(45000);
    const seekTimeout = pendingTimeouts.find(
      (entry) => entry.ms === internals.AVPLAY_SEEK_TIMEOUT_MS
    );
    assert.ok(seekTimeout, "seekAvPlayTo must schedule AVPLAY_SEEK_TIMEOUT_MS timer");
    seekTimeout.fn();
    assert.deepEqual(
      env.screenSaverCalls,
      [SCREEN_SAVER_OFF, SCREEN_SAVER_ON],
      "AVPlay seek timeout must clear player-session and restore SCREEN_SAVER_ON"
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("PlayerController native <video> waiting, playing, pause, resume, ended (VOD vs live), error, attemptVideoPlay rejection, early play() error, and document.hidden", async () => {
  // 1. Native waiting/playing/pause/resume/VOD ended
  setupControllerWithMockVideo();
  await PlayerController.play("http://127.0.0.1:18080/movie.mp4", {
    itemId: "tt-native-1",
    forceEngine: "native-file"
  });
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF]);

  env.video.dispatchEvent("waiting");
  env.video.dispatchEvent("playing");
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF]);

  PlayerController.pause();
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF, SCREEN_SAVER_ON]);

  PlayerController.resume();
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF, SCREEN_SAVER_ON, SCREEN_SAVER_OFF]);

  env.video.ended = true;
  env.video.dispatchEvent("ended");
  assert.deepEqual(env.screenSaverCalls, [
    SCREEN_SAVER_OFF,
    SCREEN_SAVER_ON,
    SCREEN_SAVER_OFF,
    SCREEN_SAVER_ON
  ]);
  await PlayerController.stop({ flushProgress: false });

  // 2. Live stream ended resumes and stays SCREEN_SAVER_OFF, then video error clears -> SCREEN_SAVER_ON
  env = createEnvironment();
  setupControllerWithMockVideo();
  await PlayerController.play("http://127.0.0.1:18080/live.mp4", {
    itemId: "tt-live-1",
    itemType: "tv",
    forceEngine: "native-file"
  });
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF]);
  env.video.dispatchEvent("ended");
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF]);
  env.video.dispatchEvent("error");
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF, SCREEN_SAVER_ON]);
  await PlayerController.stop({ flushProgress: false });

  // 3. document.hidden releases SCREEN_SAVER_ON immediately
  env = createEnvironment();
  setupControllerWithMockVideo();
  await PlayerController.play("http://127.0.0.1:18080/movie.mp4", {
    itemId: "tt-hidden-1",
    forceEngine: "native-file"
  });
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF]);
  env.document.hidden = true;
  env.document.visibilityState = "hidden";
  env.document.dispatchEvent("visibilitychange");
  assert.deepEqual(
    env.screenSaverCalls,
    [SCREEN_SAVER_OFF, SCREEN_SAVER_ON],
    "document.hidden must immediately restore SCREEN_SAVER_ON"
  );
  await PlayerController.stop({ flushProgress: false });

  // 4. attemptVideoPlay rejection clears player-session -> SCREEN_SAVER_ON
  env = createEnvironment();
  setupControllerWithMockVideo();
  env.video.play = () => Promise.reject(new Error("NotSupportedError: decoder rejected"));
  await PlayerController.play("http://127.0.0.1:18080/bad.mp4", {
    itemId: "tt-reject-1",
    forceEngine: "native-file"
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(
    env.screenSaverCalls,
    [SCREEN_SAVER_OFF, SCREEN_SAVER_ON],
    "attemptVideoPlay rejection must clear player-session and restore SCREEN_SAVER_ON"
  );
  await PlayerController.stop({ flushProgress: false });

  // 5. Early play() error (remote progressive AVPlay startup failure before prepareAsync) -> SCREEN_SAVER_ON
  env = createEnvironment();
  avplayInstance = createMockAvPlay({
    open() {
      throw new Error("avplay open failed");
    }
  });
  setupControllerWithMockVideo();
  await PlayerController.play("https://cdn.example.com/stream.mkv", {
    itemId: "tt-early-1",
    forceEngine: "tizen-avplay"
  });
  assert.deepEqual(
    env.screenSaverCalls,
    [SCREEN_SAVER_OFF, SCREEN_SAVER_ON],
    "early play() AVPlay open error must clear player-session and restore SCREEN_SAVER_ON"
  );
  await PlayerController.stop({ flushProgress: false });

  // 6. attemptVideoPlay beforePlay rejection (outer .catch) clears buffering -> SCREEN_SAVER_ON
  env = createEnvironment();
  setupControllerWithMockVideo();
  const originalWaitForNativeMediaId = PlayerController.waitForNativeMediaId;
  PlayerController.waitForNativeMediaId = () => Promise.reject(new Error("mediaId failed"));
  try {
    await PlayerController.play("http://127.0.0.1:18080/movie.mp4", {
      itemId: "tt-beforeplay-1",
      forceEngine: "native-file"
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(
      env.screenSaverCalls,
      [SCREEN_SAVER_OFF, SCREEN_SAVER_ON],
      "beforePlay rejection in attemptVideoPlay must clear player-session and restore SCREEN_SAVER_ON"
    );
  } finally {
    PlayerController.waitForNativeMediaId = originalWaitForNativeMediaId;
    await PlayerController.stop({ flushProgress: false });
  }

  // 7. native video pause / waiting / emptied events and resume() rejection -> SCREEN_SAVER_ON
  env = createEnvironment();
  setupControllerWithMockVideo();
  await PlayerController.play("http://127.0.0.1:18080/movie.mp4", {
    itemId: "tt-events-1",
    forceEngine: "native-file"
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF]);
  env.video.dispatchEvent("pause");
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF, SCREEN_SAVER_ON]);

  env.video.play = () => Promise.reject(new Error("NotSupportedError: resume failed"));
  PlayerController.resume();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(
    env.screenSaverCalls,
    [SCREEN_SAVER_OFF, SCREEN_SAVER_ON, SCREEN_SAVER_OFF, SCREEN_SAVER_ON],
    "rejected resume() must clear player-session and restore SCREEN_SAVER_ON"
  );
  env.video.play = () => {
    env.video.paused = false;
    return Promise.resolve();
  };
  PlayerController.resume();
  PlayerController.isPlaying = false;
  env.video.dispatchEvent("waiting");
  assert.deepEqual(env.screenSaverCalls, [
    SCREEN_SAVER_OFF,
    SCREEN_SAVER_ON,
    SCREEN_SAVER_OFF,
    SCREEN_SAVER_ON,
    SCREEN_SAVER_OFF
  ]);
  env.video.dispatchEvent("emptied");
  assert.deepEqual(env.screenSaverCalls, [
    SCREEN_SAVER_OFF,
    SCREEN_SAVER_ON,
    SCREEN_SAVER_OFF,
    SCREEN_SAVER_ON,
    SCREEN_SAVER_OFF,
    SCREEN_SAVER_ON
  ]);
  await PlayerController.stop({ flushProgress: false });

  // 8. async play() rejection before engine launch restores SCREEN_SAVER_ON
  env = createEnvironment();
  setupControllerWithMockVideo();
  const originalResolveRemoteMediaSourceType = PlayerController.resolveRemoteMediaSourceType;
  PlayerController.resolveRemoteMediaSourceType = () => Promise.reject(new Error("probe failed"));
  try {
    await assert.rejects(
      () => PlayerController.play("http://127.0.0.1:18080/movie.mp4", { itemId: "tt-async-err" }),
      /probe failed/
    );
    assert.deepEqual(
      env.screenSaverCalls,
      [SCREEN_SAVER_OFF, SCREEN_SAVER_ON],
      "async play() rejection must clear player-session and restore SCREEN_SAVER_ON"
    );
  } finally {
    PlayerController.resolveRemoteMediaSourceType = originalResolveRemoteMediaSourceType;
    await PlayerController.stop({ flushProgress: false });
  }
});

test("webOS syncWebOsPlaybackKeepAwake behavior remains intact without calling TizenScreenSaver", async () => {
  globalThis.__NUVIO_PLATFORM__ = "webos";
  Platform.current = null;
  setupControllerWithMockVideo();

  await PlayerController.play("http://127.0.0.1:18080/movie.mp4", {
    itemId: "tt-webos-1",
    forceEngine: "native-file"
  });
  assert.deepEqual(env.screenSaverCalls, [], "webOS playback must never call TizenScreenSaver");
  assert.deepEqual(env.webosWindowCalls, [true, "true"]);

  PlayerController.pause();
  assert.deepEqual(env.screenSaverCalls, []);
  assert.deepEqual(env.webosWindowCalls, [true, "true", false, "false"]);

  PlayerController.resume();
  assert.deepEqual(env.screenSaverCalls, []);
  assert.deepEqual(env.webosWindowCalls, [true, "true", false, "false", true, "true"]);

  await PlayerController.stop({ flushProgress: false });
  assert.deepEqual(env.screenSaverCalls, []);
  assert.deepEqual(env.webosWindowCalls, [
    true,
    "true",
    false,
    "false",
    true,
    "true",
    false,
    "false"
  ]);
});

test("nuvio:beforeExitApp before first TizenScreenSaver.block/unblock suppresses all subsequent setScreenSaver calls", async () => {
  const screenSaver = await loadIsolatedTizenScreenSaver();

  env.document.dispatchEvent(new globalThis.CustomEvent("nuvio:beforeExitApp"));
  screenSaver.block("ambient-mode");
  screenSaver.block("player-session");
  screenSaver.unblock("player-session");
  screenSaver.unblock("ambient-mode");

  assert.deepEqual(
    env.screenSaverCalls,
    [],
    "nuvio:beforeExitApp dispatched before first block/unblock must suppress all subsequent setScreenSaver calls"
  );
});

test("executePlaySession preserves SCREEN_SAVER_ON on synchronous AVPlay prepareAsync throw, synchronous prepare->play throw, and startupAudioGate error paths", async () => {
  // 1. Synchronous avplay.prepareAsync throw
  avplayInstance = createMockAvPlay({
    prepareAsync() {
      throw new Error("sync prepareAsync boom");
    }
  });
  setupControllerWithMockVideo();
  await PlayerController.play("http://127.0.0.1:18080/movie.mkv", {
    itemId: "tt-sync-prep-err",
    forceEngine: "tizen-avplay"
  });
  assert.equal(PlayerController.isPlaying, false);
  assert.equal(PlayerController.playbackEngine, "none");
  assert.ok(PlayerController.lastPlaybackErrorCode > 0);
  assert.equal(PlayerController.progressSaveTimer, null);
  assert.deepEqual(
    env.screenSaverCalls,
    [SCREEN_SAVER_OFF, SCREEN_SAVER_ON],
    "synchronous prepareAsync throw must not be overwritten back to SCREEN_SAVER_OFF"
  );
  await PlayerController.stop({ flushProgress: false });

  // 2. Synchronous avplay.prepare() -> avplay.play() throw
  env = createEnvironment();
  avplayInstance = createMockAvPlay({
    prepareAsync: undefined,
    prepare() {
      this.setState("READY");
    },
    play() {
      throw new Error("sync avplay play boom");
    }
  });
  setupControllerWithMockVideo();
  await PlayerController.play("http://127.0.0.1:18080/movie.mkv", {
    itemId: "tt-sync-play-err",
    forceEngine: "tizen-avplay"
  });
  assert.equal(PlayerController.isPlaying, false);
  assert.ok(PlayerController.lastPlaybackErrorCode > 0);
  assert.equal(PlayerController.progressSaveTimer, null);
  assert.deepEqual(
    env.screenSaverCalls,
    [SCREEN_SAVER_OFF, SCREEN_SAVER_ON],
    "synchronous avplay.prepare()->play() throw must not be overwritten back to SCREEN_SAVER_OFF"
  );
  await PlayerController.stop({ flushProgress: false });

  // 3. startupAudioGateActive = true during AVPlay onerror and onPrepareError (C2b)
  env = createEnvironment();
  avplayInstance = createMockAvPlay();
  setupControllerWithMockVideo();
  PlayerController.setStartupAudioGate(true);
  await PlayerController.play("http://127.0.0.1:18080/movie.mkv", {
    itemId: "tt-gate-onerror",
    forceEngine: "tizen-avplay"
  });
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF]);
  avplayInstance.listeners.onerror("PLAYER_ERROR_CONNECTION_FAILED");
  assert.equal(PlayerController.startupAudioGateActive, false);
  assert.equal(PlayerController.isPlaybackBuffering(), false);
  assert.deepEqual(
    env.screenSaverCalls,
    [SCREEN_SAVER_OFF, SCREEN_SAVER_ON],
    "AVPlay onerror while startupAudioGateActive=true must clear gate and restore SCREEN_SAVER_ON"
  );
  await PlayerController.stop({ flushProgress: false });

  env = createEnvironment();
  avplayInstance = createMockAvPlay();
  setupControllerWithMockVideo();
  PlayerController.setStartupAudioGate(true);
  await PlayerController.play("http://127.0.0.1:18080/movie.mkv", {
    itemId: "tt-gate-onprepareerr",
    forceEngine: "tizen-avplay"
  });
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF]);
  avplayInstance._onPrepareError("PLAYER_ERROR_NOT_SUPPORTED_FILE");
  assert.equal(PlayerController.startupAudioGateActive, false);
  assert.equal(PlayerController.isPlaybackBuffering(), false);
  assert.deepEqual(
    env.screenSaverCalls,
    [SCREEN_SAVER_OFF, SCREEN_SAVER_ON],
    "AVPlay onPrepareError while startupAudioGateActive=true must clear gate and restore SCREEN_SAVER_ON"
  );
  await PlayerController.stop({ flushProgress: false });
});

test("native <video> pause -> play/playing outside resume() and stream-switch queued pause race keep SCREEN_SAVER_OFF", async () => {
  // 1. Native <video> pause -> play + playing outside PlayerController.resume()
  setupControllerWithMockVideo();
  await PlayerController.play("http://127.0.0.1:18080/movie.mp4", {
    itemId: "tt-native-resume-events",
    forceEngine: "native-file"
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF]);

  env.video.paused = true;
  env.video.dispatchEvent("pause");
  assert.equal(PlayerController.isPlaying, false);
  assert.equal(PlayerController.playbackPaused, true);
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF, SCREEN_SAVER_ON]);

  env.video.paused = false;
  env.video.dispatchEvent("play");
  env.video.dispatchEvent("playing");
  assert.equal(PlayerController.isPlaying, true);
  assert.equal(PlayerController.playbackPaused, false);
  assert.equal(PlayerController.playbackBuffering, false);
  assert.ok(PlayerController.progressSaveTimer !== null, "playing must restart progress saving");
  assert.deepEqual(
    env.screenSaverCalls,
    [SCREEN_SAVER_OFF, SCREEN_SAVER_ON, SCREEN_SAVER_OFF],
    "native play/playing after pause must restore isPlaying and SCREEN_SAVER_OFF"
  );
  await PlayerController.stop({ flushProgress: false });

  // 2. Chromium async queued pause race on PlayerController.play(stream2) without stop() (C4)
  env = createEnvironment();
  const basePause = env.video.pause.bind(env.video);
  env.video.pause = function pauseWithQueuedEvent() {
    const wasPlaying = !this.paused;
    basePause();
    if (wasPlaying) {
      setTimeout(() => {
        this.dispatchEvent("pause");
      }, 0);
    }
  };
  setupControllerWithMockVideo();

  await PlayerController.play("http://127.0.0.1:18080/stream1.mp4", {
    itemId: "tt-c4-1",
    forceEngine: "native-file"
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  env.video.dispatchEvent("play");
  env.video.dispatchEvent("playing");
  assert.equal(env.video.paused, false);
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF]);

  // Switch directly to stream 2 without calling stop().
  await PlayerController.play("http://127.0.0.1:18080/stream2.mp4", {
    itemId: "tt-c4-2",
    forceEngine: "native-file"
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  env.video.dispatchEvent("play");
  env.video.dispatchEvent("playing");

  assert.equal(PlayerController.shouldKeepTizenPlaybackAwake(), true);
  assert.equal(PlayerController.isPlaying, true);
  assert.equal(PlayerController.playbackPaused, false);
  assert.deepEqual(
    env.screenSaverCalls,
    [SCREEN_SAVER_OFF],
    "queued teardown pause during stream switch must not flip SCREEN_SAVER_ON during active playback"
  );

  // Subsequent genuine user pause on stream 2 still works and restores SCREEN_SAVER_ON.
  env.video.paused = true;
  env.video.dispatchEvent("pause");
  assert.equal(PlayerController.playbackPaused, true);
  assert.equal(PlayerController.isPlaying, false);
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF, SCREEN_SAVER_ON]);
  await PlayerController.stop({ flushProgress: false });
});

test("hls.js MANIFEST_PARSED play rejection and synchronous loadSource throw restore SCREEN_SAVER_ON", async () => {
  const originalHls = globalThis.Hls;
  try {
    let latestHls = null;
    class MockHls {
      static Events = {
        ERROR: "hlsError",
        FRAG_BUFFERED: "hlsFragBuffered",
        MEDIA_ATTACHED: "hlsMediaAttached",
        MANIFEST_LOADED: "hlsManifestLoaded",
        MANIFEST_PARSED: "hlsManifestParsed",
        AUDIO_TRACKS_UPDATED: "hlsAudioTracksUpdated",
        AUDIO_TRACK_SWITCHED: "hlsAudioTrackSwitched",
        AUDIO_TRACK_LOADED: "hlsAudioTrackLoaded",
        SUBTITLE_TRACKS_UPDATED: "hlsSubtitleTracksUpdated",
        SUBTITLE_TRACK_SWITCH: "hlsSubtitleTrackSwitch",
        SUBTITLE_TRACK_LOADED: "hlsSubtitleTrackLoaded"
      };
      static ErrorTypes = {
        NETWORK_ERROR: "networkError",
        MEDIA_ERROR: "mediaError"
      };
      static isSupported() {
        return true;
      }
      constructor() {
        this.handlers = new Map();
        latestHls = this;
      }
      on(event, cb) {
        if (!this.handlers.has(event)) this.handlers.set(event, []);
        this.handlers.get(event).push(cb);
      }
      emit(event, data) {
        for (const cb of this.handlers.get(event) || []) {
          cb(event, data);
        }
      }
      attachMedia() {
        this.emit(MockHls.Events.MEDIA_ATTACHED);
      }
      loadSource() {}
      startLoad() {}
      destroy() {}
    }
    globalThis.Hls = MockHls;

    // 1. MANIFEST_PARSED video.play() rejection clears wake lock -> SCREEN_SAVER_ON
    setupControllerWithMockVideo();
    env.video.play = () => Promise.reject(new Error("NotSupportedError: hls decoder rejected"));
    await PlayerController.play("http://127.0.0.1:18080/live.m3u8", {
      itemId: "tt-hls-reject",
      forceEngine: "hls.js"
    });
    assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF]);
    latestHls.emit(MockHls.Events.MANIFEST_PARSED);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(PlayerController.isPlaying, false);
    assert.equal(PlayerController.playbackBuffering, false);
    assert.deepEqual(
      env.screenSaverCalls,
      [SCREEN_SAVER_OFF, SCREEN_SAVER_ON],
      "hls.js MANIFEST_PARSED play() rejection must restore SCREEN_SAVER_ON"
    );
    await PlayerController.stop({ flushProgress: false });

    // 2. Synchronous hls.loadSource() throw does not get overwritten by executePlaySession
    env = createEnvironment();
    MockHls.prototype.loadSource = () => {
      throw new Error("sync loadSource boom");
    };
    setupControllerWithMockVideo();
    await PlayerController.play("http://127.0.0.1:18080/bad.m3u8", {
      itemId: "tt-hls-sync-err",
      forceEngine: "hls.js"
    });
    assert.equal(PlayerController.isPlaying, false);
    assert.equal(PlayerController.playbackEngine, "none");
    assert.equal(PlayerController.lastPlaybackErrorCode, 4);
    assert.deepEqual(
      env.screenSaverCalls,
      [SCREEN_SAVER_OFF, SCREEN_SAVER_ON],
      "synchronous hls.loadSource throw must keep SCREEN_SAVER_ON"
    );
    await PlayerController.stop({ flushProgress: false });
  } finally {
    globalThis.Hls = originalHls;
  }
});

test("attemptVideoPlay onRejected fallback synchronous throws preserve isPlaying === false and SCREEN_SAVER_ON", async () => {
  // Probe 3-real: native-file video.play() rejects with unsupported-source error -> playWithAvPlay() -> sync prepareAsync throw
  avplayInstance = createMockAvPlay({
    prepareAsync() {
      throw new Error("sync fallback prepareAsync boom");
    }
  });
  setupControllerWithMockVideo();
  env.video.play = () =>
    Promise.reject(new Error("Failed to load because no supported source was found."));
  await PlayerController.play("http://127.0.0.1:18080/movie.mkv", {
    itemId: "tt-probe3-real",
    forceEngine: "native-file"
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(PlayerController.isPlaying, false);
  assert.equal(PlayerController.playbackEngine, "none");
  assert.equal(PlayerController.lastPlaybackErrorCode, 4);
  assert.equal(PlayerController.progressSaveTimer, null);
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF, SCREEN_SAVER_ON]);

  env.document.dispatchEvent(new globalThis.Event("visibilitychange"));
  assert.deepEqual(
    env.screenSaverCalls,
    [SCREEN_SAVER_OFF, SCREEN_SAVER_ON],
    "visibilitychange after failed native-file -> AVPlay fallback must keep SCREEN_SAVER_ON"
  );
  await PlayerController.stop({ flushProgress: false });

  // Probe 3b-real: native-hls video.play() rejects with unsupported-source error -> playWithHlsJs() -> sync loadSource throw
  const originalHls = globalThis.Hls;
  try {
    class MockHlsSyncThrow {
      static Events = {
        ERROR: "hlsError",
        FRAG_BUFFERED: "hlsFragBuffered",
        MEDIA_ATTACHED: "hlsMediaAttached",
        MANIFEST_LOADED: "hlsManifestLoaded",
        MANIFEST_PARSED: "hlsManifestParsed",
        AUDIO_TRACKS_UPDATED: "hlsAudioTracksUpdated",
        AUDIO_TRACK_SWITCHED: "hlsAudioTrackSwitched",
        AUDIO_TRACK_LOADED: "hlsAudioTrackLoaded",
        SUBTITLE_TRACKS_UPDATED: "hlsSubtitleTracksUpdated",
        SUBTITLE_TRACK_SWITCH: "hlsSubtitleTrackSwitch",
        SUBTITLE_TRACK_LOADED: "hlsSubtitleTrackLoaded"
      };
      static ErrorTypes = {
        NETWORK_ERROR: "networkError",
        MEDIA_ERROR: "mediaError"
      };
      static isSupported() {
        return true;
      }
      constructor() {
        this.handlers = new Map();
      }
      on(event, cb) {
        if (!this.handlers.has(event)) this.handlers.set(event, []);
        this.handlers.get(event).push(cb);
      }
      emit(event, data) {
        for (const cb of this.handlers.get(event) || []) {
          cb(event, data);
        }
      }
      attachMedia() {
        this.emit(MockHlsSyncThrow.Events.MEDIA_ATTACHED);
      }
      loadSource() {
        throw new Error("sync fallback loadSource boom");
      }
      startLoad() {}
      destroy() {}
    }
    globalThis.Hls = MockHlsSyncThrow;
    env = createEnvironment();
    avplayInstance = null;
    setupControllerWithMockVideo();
    env.video.play = () =>
      Promise.reject(new Error("Failed to load because no supported source was found."));
    await PlayerController.play("http://127.0.0.1:18080/live.m3u8", {
      itemId: "tt-probe3b-real",
      forceEngine: "native-hls"
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(PlayerController.isPlaying, false);
    assert.equal(PlayerController.playbackEngine, "none");
    assert.equal(PlayerController.lastPlaybackErrorCode, 4);
    assert.equal(PlayerController.progressSaveTimer, null);
    assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF, SCREEN_SAVER_ON]);

    env.document.dispatchEvent(new globalThis.Event("visibilitychange"));
    assert.deepEqual(
      env.screenSaverCalls,
      [SCREEN_SAVER_OFF, SCREEN_SAVER_ON],
      "visibilitychange after failed native-hls -> hls.js fallback must keep SCREEN_SAVER_ON"
    );
    await PlayerController.stop({ flushProgress: false });
  } finally {
    globalThis.Hls = originalHls;
  }
});

test("suppressedNativePauseEvents does not leak across AVPlay failures, non-emitting pause(), or throwing pause() while preserving C4", async () => {
  // Probe 4a: native -> AVPlay onPrepareError without "pause" emitted -> new native session genuine "pause" before "playing"
  avplayInstance = createMockAvPlay();
  setupControllerWithMockVideo();
  await PlayerController.play("http://127.0.0.1:18080/s1.mp4", {
    itemId: "tt-probe4a-1",
    forceEngine: "native-file"
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(env.video.paused, false);

  await PlayerController.play("http://127.0.0.1:18080/s2.mkv", {
    itemId: "tt-probe4a-2",
    forceEngine: "tizen-avplay"
  });
  avplayInstance._onPrepareError("PLAYER_ERROR_NOT_SUPPORTED_FILE");
  assert.equal(PlayerController.suppressedNativePauseEvents, 0);

  await PlayerController.play("http://127.0.0.1:18080/s3.mp4", {
    itemId: "tt-probe4a-3",
    forceEngine: "native-file"
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  env.video.dispatchEvent("play");
  env.video.paused = true;
  env.video.dispatchEvent("pause");
  assert.equal(PlayerController.playbackPaused, true);
  assert.equal(PlayerController.isPlaying, false);
  assert.equal(env.screenSaverCalls[env.screenSaverCalls.length - 1], SCREEN_SAVER_ON);
  await PlayerController.stop({ flushProgress: false });

  // Probe 4b: native -> native with non-emitting video.pause() -> "play" -> genuine "pause" before "playing"
  env = createEnvironment();
  avplayInstance = null;
  setupControllerWithMockVideo();
  await PlayerController.play("http://127.0.0.1:18080/s1.mp4", {
    itemId: "tt-probe4b-1",
    forceEngine: "native-file"
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(env.video.paused, false);

  await PlayerController.play("http://127.0.0.1:18080/s2.mp4", {
    itemId: "tt-probe4b-2",
    forceEngine: "native-file"
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  env.video.dispatchEvent("play");
  env.video.paused = true;
  env.video.dispatchEvent("pause");
  assert.equal(PlayerController.playbackPaused, true);
  assert.equal(PlayerController.isPlaying, false);
  assert.equal(env.screenSaverCalls[env.screenSaverCalls.length - 1], SCREEN_SAVER_ON);
  await PlayerController.stop({ flushProgress: false });

  // Probe 4b + C4 sync-"play" variant: video.play() emits "play" synchronously before queued s1 setTimeout(0) "pause" fires
  env = createEnvironment();
  const basePauseSyncPlay = env.video.pause.bind(env.video);
  env.video.pause = function pauseWithQueuedEvent() {
    const wasPlaying = !this.paused;
    basePauseSyncPlay();
    if (wasPlaying) {
      setTimeout(() => {
        this.dispatchEvent("pause");
      }, 0);
    }
  };
  env.video.play = function playWithSyncEvent() {
    this.paused = false;
    this.dispatchEvent("play");
    return Promise.resolve();
  };
  setupControllerWithMockVideo();
  await PlayerController.play("http://127.0.0.1:18080/s1-sync.mp4", {
    itemId: "tt-c4-syncplay-1",
    forceEngine: "native-file"
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(env.video.paused, false);

  await PlayerController.play("http://127.0.0.1:18080/s2-sync.mp4", {
    itemId: "tt-c4-syncplay-2",
    forceEngine: "native-file"
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(PlayerController.isPlaying, true);
  assert.equal(PlayerController.playbackPaused, false);
  assert.deepEqual(
    env.screenSaverCalls,
    [SCREEN_SAVER_OFF],
    "queued s1 pause arriving after s2 sync play event must still be suppressed while video.paused === false"
  );
  env.video.paused = true;
  env.video.dispatchEvent("pause");
  assert.equal(PlayerController.playbackPaused, true);
  assert.equal(PlayerController.isPlaying, false);
  assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF, SCREEN_SAVER_ON]);
  await PlayerController.stop({ flushProgress: false });

  // Probe 4c: video.pause() throwing inside executePlaySession() must reset suppressedNativePauseEvents === 0
  env = createEnvironment();
  setupControllerWithMockVideo();
  await PlayerController.play("http://127.0.0.1:18080/s1-throw.mp4", {
    itemId: "tt-probe4c-1",
    forceEngine: "native-file"
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(env.video.paused, false);
  env.video.pause = () => {
    throw new Error("legacy video.pause failed");
  };
  await PlayerController.play("http://127.0.0.1:18080/s2-throw.mp4", {
    itemId: "tt-probe4c-2",
    forceEngine: "native-file"
  });
  assert.equal(PlayerController.suppressedNativePauseEvents, 0);
  await PlayerController.stop({ flushProgress: false });
});

test("nuvio:beforeExitApp suppresses SCREEN_SAVER_ON on real AmbientMode and PlayerController.stop()", async () => {
  const originalPerf = globalThis.performance;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  globalThis.performance = { now: () => 0 };
  globalThis.setInterval = () => 1;
  globalThis.clearInterval = () => {};

  try {
    setupControllerWithMockVideo();
    await PlayerController.play("http://127.0.0.1:18080/movie.mp4", {
      itemId: "tt-exit-real",
      forceEngine: "native-file"
    });
    assert.deepEqual(env.screenSaverCalls, [SCREEN_SAVER_OFF]);

    AmbientMode.started = false;
    AmbientMode.start();
    env.document.dispatchEvent(new globalThis.CustomEvent("nuvio:beforeExitApp"));
    await PlayerController.stop({ flushProgress: false });
    env.document.hidden = true;
    env.document.visibilityState = "hidden";
    env.document.dispatchEvent(new globalThis.Event("visibilitychange"));
    AmbientMode.tick();

    assert.deepEqual(
      env.screenSaverCalls,
      [SCREEN_SAVER_OFF],
      "nuvio:beforeExitApp must suppress SCREEN_SAVER_ON on both PlayerController.stop() and AmbientMode"
    );
  } finally {
    globalThis.performance = originalPerf;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});
