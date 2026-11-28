const SCREEN_SAVER_OFF = 0;
const SCREEN_SAVER_ON = 1;
const DEFAULT_REASON = "ambient-mode";

const activeReasons = new Set();
let blocked = false;
let exiting = false;
let boundExitDocument = null;

function normalizeReason(reason) {
  const value = String(reason ?? "").trim();
  return value || DEFAULT_REASON;
}

function handleBeforeExitApp() {
  exiting = true;
  activeReasons.clear();
  blocked = false;
}

function bindExitListener() {
  const doc = globalThis.document;
  if (!doc || typeof doc.addEventListener !== "function" || boundExitDocument === doc) {
    return;
  }
  if (boundExitDocument && typeof boundExitDocument.removeEventListener === "function") {
    try {
      boundExitDocument.removeEventListener("nuvio:beforeExitApp", handleBeforeExitApp);
    } catch (_) {
      // Ignore cleanup failures on synthetic test documents.
    }
  }
  boundExitDocument = doc;
  doc.addEventListener("nuvio:beforeExitApp", handleBeforeExitApp);
}

bindExitListener();

function applyScreenSaver(state) {
  try {
    const appcommon = globalThis.webapis?.appcommon;
    if (typeof appcommon?.setScreenSaver !== "function") return;
    const states = appcommon.AppCommonScreenSaverState;
    const value =
      state === SCREEN_SAVER_OFF
        ? (states?.SCREEN_SAVER_OFF ?? SCREEN_SAVER_OFF)
        : (states?.SCREEN_SAVER_ON ?? SCREEN_SAVER_ON);
    appcommon.setScreenSaver(value);
  } catch (_) {
    // The Samsung screensaver API is optional and can reject on older runtimes.
  }
}

// Samsung's screensaver covers app content with a black screen. Ambient Mode
// and active playback each hold an independent reason so neither can re-enable
// the screensaver while the other still needs the display awake.
export const TizenScreenSaver = {
  block(reason = DEFAULT_REASON) {
    bindExitListener();
    if (exiting) return;
    activeReasons.add(normalizeReason(reason));
    if (blocked) return;
    blocked = true;
    applyScreenSaver(SCREEN_SAVER_OFF);
  },

  unblock(reason = DEFAULT_REASON) {
    bindExitListener();
    if (exiting) return;
    activeReasons.delete(normalizeReason(reason));
    if (!blocked || activeReasons.size > 0) return;
    blocked = false;
    applyScreenSaver(SCREEN_SAVER_ON);
  }
};
