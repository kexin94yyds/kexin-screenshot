const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  systemPreferences,
} = require('electron');

const APP_NAME = '可鑫的截屏小工具';
const SHORTCUT = 'CommandOrControl+K';
const SCREEN_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

let overlayWindow = null;
let overlayWindowReady = null;
let captureSession = null;
let captureStarting = false;
let shortcutRegistered = false;
let captureWarmupTimer = null;
let captureWarmupPromise = null;
let nativeHelperServerProcess = null;
let nativeHelperServerStdoutBuffer = '';
let nativeHelperServerRequestId = 0;
const nativeHelperServerPendingRequests = new Map();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearCaptureWarmupTimer() {
  if (!captureWarmupTimer) {
    return;
  }

  clearTimeout(captureWarmupTimer);
  captureWarmupTimer = null;
}

function getScreenPermissionStatus() {
  if (process.platform !== 'darwin') {
    return 'granted';
  }

  return systemPreferences.getMediaAccessStatus('screen');
}

function getAppStatus() {
  return {
    appName: APP_NAME,
    shortcut: SHORTCUT,
    shortcutRegistered,
    screenPermission: getScreenPermissionStatus(),
    captureInProgress: Boolean(captureSession || captureStarting),
  };
}

async function warmCaptureBackend() {
  if (captureWarmupPromise || captureSession || captureStarting) {
    return captureWarmupPromise;
  }

  if (getScreenPermissionStatus() !== 'granted') {
    return null;
  }

  captureWarmupPromise = (async () => {
    const helperPath = getNativeCaptureHelperPath();

    if (helperPath) {
      const warmupStartedAt = Date.now();
      await requestNativeHelperServer({ type: 'warmup' }, 4000).catch(() => {
        return execFileAsync(helperPath, ['--warmup']).catch(() => null);
      });
      console.log(`[${APP_NAME}] native capture warmup`, {
        elapsedMs: Date.now() - warmupStartedAt,
      });
      return true;
    }

    await desktopCapturer
      .getSources({
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 },
        fetchWindowIcons: false,
      })
      .catch(() => null);

    return true;
  })().finally(() => {
    captureWarmupPromise = null;
  });

  return captureWarmupPromise;
}

function scheduleCaptureWarmup(delayMs = 0) {
  clearCaptureWarmupTimer();
  captureWarmupTimer = setTimeout(() => {
    captureWarmupTimer = null;
    void warmCaptureBackend();
  }, delayMs);
}

function registerShortcut() {
  shortcutRegistered = globalShortcut.register(SHORTCUT, () => {
    void startCapture();
  });

  if (!shortcutRegistered) {
    console.warn(`[${APP_NAME}] Failed to register shortcut ${SHORTCUT}`);
  }
}

async function getDisplaySource(display) {
  const thumbnailSize = {
    width: Math.max(1, Math.round(display.bounds.width * display.scaleFactor)),
    height: Math.max(1, Math.round(display.bounds.height * display.scaleFactor)),
  };

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize,
    fetchWindowIcons: false,
  });

  return sources.find((source) => source.display_id === String(display.id)) ?? null;
}

async function getDisplaySourceWithRetry(display, attempts = 3) {
  let source = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    source = await getDisplaySource(display);

    if (source?.thumbnail && !source.thumbnail.isEmpty()) {
      return source;
    }

    await delay(80);
  }

  return source;
}

function execFileAsync(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function rejectPendingNativeHelperRequests(error) {
  for (const pending of nativeHelperServerPendingRequests.values()) {
    clearTimeout(pending.timeout);
    pending.reject(error);
  }

  nativeHelperServerPendingRequests.clear();
}

function getNativeCaptureHelperPath() {
  const candidatePaths = [
    path.join(process.resourcesPath, 'native', 'QQShotCaptureCLI'),
    path.join(__dirname, 'native-swift', 'local-build', 'QQShotCaptureCLI'),
  ];

  return candidatePaths.find((candidate) => {
    try {
      return require('node:fs').existsSync(candidate);
    } catch {
      return false;
    }
  }) ?? null;
}

function teardownNativeHelperServer(error = new Error('Native helper server stopped.')) {
  if (nativeHelperServerProcess) {
    nativeHelperServerProcess.removeAllListeners();
    nativeHelperServerProcess.stdout?.removeAllListeners();
    nativeHelperServerProcess.stderr?.removeAllListeners();
  }

  rejectPendingNativeHelperRequests(error);
  nativeHelperServerProcess = null;
  nativeHelperServerStdoutBuffer = '';
}

function handleNativeHelperServerStdout(chunk) {
  nativeHelperServerStdoutBuffer += chunk.toString();
  const lines = nativeHelperServerStdoutBuffer.split('\n');
  nativeHelperServerStdoutBuffer = lines.pop() ?? '';

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    let response = null;
    try {
      response = JSON.parse(line);
    } catch {
      continue;
    }

    const pending = nativeHelperServerPendingRequests.get(response.id);
    if (!pending) {
      continue;
    }

    clearTimeout(pending.timeout);
    nativeHelperServerPendingRequests.delete(response.id);

    if (response.ok) {
      pending.resolve(response);
      continue;
    }

    pending.reject(new Error(response.error ?? 'Native helper request failed.'));
  }
}

function ensureNativeHelperServer() {
  if (process.platform !== 'darwin') {
    return null;
  }

  if (nativeHelperServerProcess && !nativeHelperServerProcess.killed) {
    return nativeHelperServerProcess;
  }

  const helperPath = getNativeCaptureHelperPath();
  if (!helperPath) {
    return null;
  }

  const helperProcess = spawn(helperPath, ['--server'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  helperProcess.stdout.on('data', handleNativeHelperServerStdout);
  helperProcess.stderr.on('data', (chunk) => {
    const message = chunk.toString().trim();
    if (message) {
      console.warn(`[${APP_NAME}] native helper stderr`, message);
    }
  });
  helperProcess.on('exit', (code, signal) => {
    teardownNativeHelperServer(
      new Error(`Native helper server exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`)
    );
  });
  helperProcess.on('error', (error) => {
    teardownNativeHelperServer(error);
  });

  nativeHelperServerProcess = helperProcess;
  nativeHelperServerStdoutBuffer = '';
  return nativeHelperServerProcess;
}

function requestNativeHelperServer(command, timeoutMs = 5000) {
  const helperProcess = ensureNativeHelperServer();
  if (!helperProcess) {
    return Promise.reject(new Error('Native helper server is unavailable.'));
  }

  const id = String(++nativeHelperServerRequestId);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      nativeHelperServerPendingRequests.delete(id);
      reject(new Error(`Native helper request timed out: ${command.type}`));
    }, timeoutMs);

    nativeHelperServerPendingRequests.set(id, { resolve, reject, timeout });

    helperProcess.stdin.write(`${JSON.stringify({ id, ...command })}\n`, (error) => {
      if (!error) {
        return;
      }

      clearTimeout(timeout);
      nativeHelperServerPendingRequests.delete(id);
      reject(error);
    });
  });
}

async function captureDisplayImageWithNativeHelper() {
  if (process.platform !== 'darwin') {
    return null;
  }

  const helperPath = getNativeCaptureHelperPath();
  if (!helperPath) {
    return null;
  }

  const captureStartedAt = Date.now();
  const tempFilePath = path.join(app.getPath('temp'), `qq-shot-native-${Date.now()}.png`);
  await requestNativeHelperServer(
    { type: 'capture', outputPath: tempFilePath },
    6000
  ).catch(() => execFileAsync(helperPath, ['--output', tempFilePath]));

  const image = nativeImage.createFromPath(tempFilePath);
  if (image.isEmpty()) {
    throw new Error('Native helper returned an empty image.');
  }

  return {
    image,
    previewSrc: pathToFileURL(tempFilePath).href,
    sourceSize: image.getSize(),
    tempFilePath,
    captureBackend: 'screenCaptureKit',
    elapsedMs: Date.now() - captureStartedAt,
  };
}

function getMacCaptureDisplayIndex(display) {
  const primaryDisplayId = screen.getPrimaryDisplay().id;
  const orderedDisplays = [...screen.getAllDisplays()].sort((left, right) => {
    if (left.id === primaryDisplayId) {
      return -1;
    }

    if (right.id === primaryDisplayId) {
      return 1;
    }

    if (left.bounds.x !== right.bounds.x) {
      return left.bounds.x - right.bounds.x;
    }

    return left.bounds.y - right.bounds.y;
  });

  const displayIndex = orderedDisplays.findIndex((item) => item.id === display.id);
  return displayIndex >= 0 ? displayIndex + 1 : 1;
}

async function captureDisplayImage(display) {
  const nativeCapture = await captureDisplayImageWithNativeHelper().catch((error) => {
    console.warn(`[${APP_NAME}] Native capture failed, falling back`, error);
    return null;
  });

  if (nativeCapture) {
    return nativeCapture;
  }

  if (process.platform === 'darwin') {
    const captureDisplayIndex = getMacCaptureDisplayIndex(display);
    const tempFilePath = path.join(app.getPath('temp'), `qq-shot-${Date.now()}.png`);

    await execFileAsync('screencapture', [
      '-x',
      '-D',
      String(captureDisplayIndex),
      tempFilePath,
    ]);

    const image = nativeImage.createFromPath(tempFilePath);
    if (!image.isEmpty()) {
      return {
        image,
        previewSrc: pathToFileURL(tempFilePath).href,
        sourceSize: image.getSize(),
        tempFilePath,
        captureBackend: 'screencapture',
      };
    }
  }

  const source = await getDisplaySourceWithRetry(display);
  if (source?.thumbnail && !source.thumbnail.isEmpty()) {
    return {
      image: source.thumbnail,
      previewSrc: source.thumbnail.toDataURL(),
      sourceSize: source.thumbnail.getSize(),
      tempFilePath: null,
      captureBackend: 'desktopCapturer',
    };
  }

  throw new Error(`Empty screen thumbnail for display ${display.id}`);
}

function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();

  overlayWindow = new BrowserWindow({
    x: primaryDisplay.bounds.x,
    y: primaryDisplay.bounds.y,
    width: primaryDisplay.bounds.width,
    height: primaryDisplay.bounds.height,
    useContentSize: true,
    enableLargerThanScreen: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: true,
    skipTaskbar: true,
    show: false,
    transparent: true,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  overlayWindow.setAlwaysOnTop(true, 'floating', 1);
  overlayWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  overlayWindow.setAlwaysOnTop(true, 'floating', 1);
  overlayWindow.setOpacity(0);
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setFocusable(false);
  overlayWindow.removeMenu();

  overlayWindow.on('closed', () => {
    overlayWindow = null;
    overlayWindowReady = null;
  });

  overlayWindowReady = new Promise((resolve) => {
    overlayWindow.webContents.once('did-finish-load', resolve);
  });

  overlayWindow.loadFile(path.join(__dirname, 'src', 'overlay.html'));
}

async function ensureOverlayWindow() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow();
  }

  await overlayWindowReady;
  return overlayWindow;
}

function hideOverlayWindow() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setFocusable(false);
  overlayWindow.setOpacity(0);
  if (!overlayWindow.isVisible()) {
    overlayWindow.showInactive();
  }
}

function focusActiveWindow() {
  if (captureSession || captureStarting) {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.showInactive();
      overlayWindow.moveTop();
      return;
    }
  }

  void startCapture();
}

function endCaptureSession() {
  const tempFilePath = captureSession?.tempFilePath ?? null;

  captureSession = null;
  hideOverlayWindow();
  scheduleCaptureWarmup(300);

  if (tempFilePath) {
    void fs.unlink(tempFilePath).catch(() => {});
  }
}

async function showPermissionDialog() {
  const buttons = process.platform === 'darwin' ? ['打开系统设置', '知道了'] : ['知道了'];
  const result = await dialog.showMessageBox({
    type: 'warning',
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
    title: APP_NAME,
    message: '需要先授予“屏幕录制”权限',
    detail:
      'macOS 会拦截无权限的屏幕抓取。请到“系统设置 > 隐私与安全性 > 屏幕录制”里允许此应用或启动它的终端/IDE，然后重新打开应用。',
  });

  if (process.platform === 'darwin' && result.response === 0) {
    await shell.openExternal(SCREEN_SETTINGS_URL);
  }
}

async function startCapture() {
  if (captureSession || captureStarting) {
    return { ok: false, reason: 'capture-in-progress' };
  }

  captureStarting = true;
  try {
    const captureStartedAt = Date.now();
    const permission = getScreenPermissionStatus();
    if (permission === 'denied' || permission === 'restricted') {
      await showPermissionDialog();
      return { ok: false, reason: 'screen-permission-denied' };
    }

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const overlayWindowPromise = ensureOverlayWindow();
    const capturePromise = captureDisplayImage(display);
    const sessionId = Date.now();
    const [currentOverlayWindow, capture] = await Promise.all([
      overlayWindowPromise,
      capturePromise,
    ]);
    const sourceSize = capture.sourceSize;

    console.log(`[${APP_NAME}] capture metrics`, {
      captureBackend: capture.captureBackend,
      captureElapsedMs: capture.elapsedMs ?? null,
      displayBounds: display.bounds,
      scaleFactor: display.scaleFactor,
      expectedSize: {
        width: Math.round(display.bounds.width * display.scaleFactor),
        height: Math.round(display.bounds.height * display.scaleFactor),
      },
      sourceSize,
    });

    captureSession = {
      id: sessionId,
      display: {
        id: display.id,
        bounds: display.bounds,
        scaleFactor: display.scaleFactor,
      },
      sourceImage: capture.image ?? null,
      sourceSize,
      tempFilePath: capture.tempFilePath,
      overlayReady: null,
      resolveOverlayReady: null,
    };

    captureSession.overlayReady = new Promise((resolve) => {
      captureSession.resolveOverlayReady = resolve;
    });

    currentOverlayWindow.setBounds(display.bounds, false);
    currentOverlayWindow.setFocusable(true);
    currentOverlayWindow.setIgnoreMouseEvents(false);
    currentOverlayWindow.setOpacity(0);
    currentOverlayWindow.webContents.send('capture-data', {
      sessionId,
      display: captureSession.display,
      preview: {
        src: capture.previewSrc,
        width: display.bounds.width,
        height: display.bounds.height,
      },
    });

    if (!currentOverlayWindow.isVisible()) {
      currentOverlayWindow.showInactive();
    }
    currentOverlayWindow.moveTop();
    void captureSession.overlayReady.then(() => {
      if (currentOverlayWindow.isDestroyed()) {
        return;
      }

      currentOverlayWindow.setOpacity(1);
    });
    void Promise.race([captureSession.overlayReady, delay(1200)]).then(() => {
      if (currentOverlayWindow.isDestroyed()) {
        return;
      }

      console.log(`[${APP_NAME}] overlay window bounds`, {
        bounds: currentOverlayWindow.getBounds(),
        contentBounds: currentOverlayWindow.getContentBounds(),
      });
      console.log(`[${APP_NAME}] capture startup timing`, {
        elapsedMs: Date.now() - captureStartedAt,
      });
    });

    return { ok: true };
  } catch (error) {
    console.error(`[${APP_NAME}] Failed to start capture`, error);
    endCaptureSession();
    await showPermissionDialog();
    return { ok: false, reason: 'capture-failed' };
  } finally {
    captureStarting = false;
  }
}

function validateSession(sessionId) {
  if (!captureSession || captureSession.id !== sessionId) {
    return false;
  }

  return true;
}

function getCaptureSourceImage() {
  if (!captureSession) {
    return null;
  }

  if (captureSession.sourceImage && !captureSession.sourceImage.isEmpty()) {
    return captureSession.sourceImage;
  }

  if (!captureSession.tempFilePath) {
    return null;
  }

  const sourceImage = nativeImage.createFromPath(captureSession.tempFilePath);
  if (!sourceImage || sourceImage.isEmpty()) {
    return null;
  }

  captureSession.sourceImage = sourceImage;
  return sourceImage;
}

function cropSelection(selection) {
  if (!captureSession || !selection) {
    return null;
  }

  const sourceImage = getCaptureSourceImage();
  if (!sourceImage) {
    return null;
  }

  const sourceSize = captureSession.sourceSize ?? sourceImage.getSize();
  const displayBounds = captureSession.display.bounds;
  const ratioX = sourceSize.width / displayBounds.width;
  const ratioY = sourceSize.height / displayBounds.height;
  const cropX = Math.min(sourceSize.width - 1, Math.max(0, Math.round(selection.x * ratioX)));
  const cropY = Math.min(sourceSize.height - 1, Math.max(0, Math.round(selection.y * ratioY)));
  const cropWidth = Math.max(
    1,
    Math.min(sourceSize.width - cropX, Math.round(selection.width * ratioX))
  );
  const cropHeight = Math.max(
    1,
    Math.min(sourceSize.height - cropY, Math.round(selection.height * ratioY))
  );

  return sourceImage.crop({
    x: cropX,
    y: cropY,
    width: cropWidth,
    height: cropHeight,
  });
}

function imageFromDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') {
    return null;
  }

  const image = nativeImage.createFromDataURL(dataUrl);
  return image.isEmpty() ? null : image;
}

function defaultScreenshotName() {
  const date = new Date();
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
  const time = [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join('-');

  return `Screenshot ${stamp} ${time}.png`;
}

ipcMain.handle('status:get', () => getAppStatus());

ipcMain.handle('control:start-capture', async () => {
  return startCapture();
});

ipcMain.handle('control:open-screen-settings', async () => {
  if (process.platform === 'darwin') {
    await shell.openExternal(SCREEN_SETTINGS_URL);
  }
});

ipcMain.handle('capture:cancel', async (_event, payload) => {
  if (!validateSession(payload.sessionId)) {
    return { ok: false };
  }

  endCaptureSession();
  return { ok: true };
});

ipcMain.handle('capture:overlay-ready', async (_event, payload) => {
  if (!validateSession(payload.sessionId)) {
    return { ok: false };
  }

  if (captureSession.resolveOverlayReady) {
    captureSession.resolveOverlayReady();
    captureSession.resolveOverlayReady = null;
  }

  return { ok: true };
});

ipcMain.on('capture:overlay-metrics', (_event, payload) => {
  console.log(`[${APP_NAME}] overlay metrics`, payload);
});

ipcMain.handle('capture:copy', async (_event, payload) => {
  if (!validateSession(payload.sessionId)) {
    return { ok: false };
  }

  const croppedImage = cropSelection(payload.selection);
  if (!croppedImage) {
    return { ok: false };
  }

  clipboard.writeImage(croppedImage);
  endCaptureSession();
  return { ok: true };
});

ipcMain.handle('capture:copy-rendered', async (_event, payload) => {
  if (!validateSession(payload.sessionId)) {
    return { ok: false };
  }

  const image = imageFromDataUrl(payload.dataUrl);
  if (!image) {
    return { ok: false };
  }

  clipboard.writeImage(image);
  endCaptureSession();
  return { ok: true };
});

ipcMain.handle('capture:save', async (_event, payload) => {
  if (!validateSession(payload.sessionId)) {
    return { ok: false };
  }

  const image = cropSelection(payload.selection);
  if (!image) {
    return { ok: false };
  }

  endCaptureSession();

  const result = await dialog.showSaveDialog({
    title: '保存截图',
    defaultPath: path.join(app.getPath('desktop'), defaultScreenshotName()),
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  });

  if (result.canceled || !result.filePath) {
    return { ok: false, canceled: true };
  }

  await fs.writeFile(result.filePath, image.toPNG());

  return { ok: true, filePath: result.filePath };
});

ipcMain.handle('capture:save-rendered', async (_event, payload) => {
  if (!validateSession(payload.sessionId)) {
    return { ok: false };
  }

  const image = imageFromDataUrl(payload.dataUrl);
  if (!image) {
    return { ok: false };
  }

  endCaptureSession();

  const result = await dialog.showSaveDialog({
    title: '保存截图',
    defaultPath: path.join(app.getPath('desktop'), defaultScreenshotName()),
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  });

  if (result.canceled || !result.filePath) {
    return { ok: false, canceled: true };
  }

  await fs.writeFile(result.filePath, image.toPNG());

  return { ok: true, filePath: result.filePath };
});

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    app.setActivationPolicy('accessory');
  }

  app.setName(APP_NAME);
  Menu.setApplicationMenu(null);

  createOverlayWindow();
  await overlayWindowReady;
  hideOverlayWindow();
  scheduleCaptureWarmup(800);
  registerShortcut();
});

app.on('activate', () => {
  if (captureSession || captureStarting) {
    focusActiveWindow();
    return;
  }

  void startCapture();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (nativeHelperServerProcess && !nativeHelperServerProcess.killed) {
    nativeHelperServerProcess.kill();
  }
});
