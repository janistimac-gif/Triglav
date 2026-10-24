const { app, BrowserWindow, BrowserView, ipcMain, session, Menu, dialog, shell, nativeTheme, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// ========== Hitrost / GPU ==========
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization,NetworkServiceInProcess2');


// ========== Nastavitve ==========
const HOME_URL = 'https://www.google.com';
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const MAX_HISTORY = 200;

const DATA_DIR = path.join(app.getPath('userData'), 'triglav');
const BOOKMARKS_FILE = path.join(DATA_DIR, 'bookmarks.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

let mainWindow = null;
let tabs = [];           // { id, view, title, url, favicon }
let activeTabId = null;
let nextTabId = 1;
let bookmarks = [];
let history = [];
let settings = {
  theme: 'dark',           // 'dark' | 'light' | 'system'
  backgroundStyle: 'default', // 'default' | 'midnight' | 'ocean' | 'slate'
  showBookmarksBar: true,
  blockTrackers: true,
  lazyImages: true,
  preloadBookmarks: true
};

// ========== Persistenca ==========
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadData() {
  ensureDataDir();
  try {
    if (fs.existsSync(BOOKMARKS_FILE)) {
      bookmarks = JSON.parse(fs.readFileSync(BOOKMARKS_FILE, 'utf8'));
    }
  } catch (e) { bookmarks = []; }

  try {
    if (fs.existsSync(HISTORY_FILE)) {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
  } catch (e) { history = []; }

  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
    }
  } catch (e) {}
}

function saveBookmarks() {
  ensureDataDir();
  fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify(bookmarks, null, 2));
  scheduleBookmarkPreload();
}

function saveHistory() {
  ensureDataDir();
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(0, MAX_HISTORY), null, 2));
}

function saveSettings() {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}


// ========== Hitrost: sledilniki, prednalaganje, lazy images ==========
// Znani sledilniki / oglasna omrežja (lahka lista – blokada na nivoju zahteve)
const TRACKER_HOSTS = new Set([
  'google-analytics.com', 'googletagmanager.com', 'googleadservices.com',
  'googlesyndication.com', 'doubleclick.net', 'googleads.g.doubleclick.net',
  'facebook.net', 'facebook.com', 'connect.facebook.net', 'fbcdn.net',
  'analytics.twitter.com', 'ads-twitter.com', 'static.ads-twitter.com',
  'hotjar.com', 'static.hotjar.com', 'script.hotjar.com',
  'segment.io', 'segment.com', 'cdn.segment.com',
  'mixpanel.com', 'cdn.mxpnl.com',
  'amplitude.com', 'api.amplitude.com',
  'clarity.ms', 'www.clarity.ms',
  'newrelic.com', 'nr-data.net',
  'scorecardresearch.com', 'quantserve.com',
  'adsafeprotected.com', 'moatads.com',
  'taboola.com', 'cdn.taboola.com',
  'outbrain.com', 'widgets.outbrain.com',
  'criteo.com', 'criteo.net',
  'adsrvr.org', 'adnxs.com',
  'pubmatic.com', 'openx.net',
  'rubiconproject.com', 'casalemedia.com',
  'advertising.com', 'adform.net',
  'chartbeat.com', 'static.chartbeat.com',
  'mouseflow.com', 'fullstory.com',
  'sentry.io', 'browser.sentry-cdn.com',
  'optimizely.com', 'cdn.optimizely.com',
  'crazyegg.com', 'heap-api.com',
  'intercom.io', 'widget.intercom.io',
  'drift.com', 'cdn.onesignal.com',
  'perf-na1.hsforms.com', 'js.hs-scripts.com',
  'js.hubspot.com', 'forms.hubspot.com'
]);

function hostMatchesTracker(hostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  if (TRACKER_HOSTS.has(h)) return true;
  for (const t of TRACKER_HOSTS) {
    if (h === t || h.endsWith('.' + t)) return true;
  }
  return false;
}

function setupSessionPerformance(ses) {
  try {
    ses.setSpellCheckerEnabled(false);
  } catch (e) {}

  // Agresivnejši disk cache (do ~512 MB)
  try {
    if (typeof ses.setCacheSize === 'function') {
      ses.setCacheSize(512 * 1024 * 1024);
    }
  } catch (e) {}

  // Blokada sledilnikov
  try {
    ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      if (!settings.blockTrackers) {
        callback({});
        return;
      }
      try {
        const u = new URL(details.url);
        if (hostMatchesTracker(u.hostname)) {
          callback({ cancel: true });
          return;
        }
      } catch (e) {}
      callback({});
    });
  } catch (e) {
    console.error('webRequest setup failed:', e);
  }
}

// Prednalaganje zaznamkov v ozadju (nevidno okno)
let preloadTimer = null;
function scheduleBookmarkPreload() {
  if (preloadTimer) clearTimeout(preloadTimer);
  preloadTimer = setTimeout(() => preloadBookmarksInBackground(), 8000);
}

function preloadBookmarksInBackground() {
  if (!settings.preloadBookmarks) return;
  if (!bookmarks || bookmarks.length === 0) return;

  const ses = session.fromPartition('persist:browser');
  const toPreload = bookmarks.slice(0, 8); // največ 8

  // Uporabi skrito BrowserWindow za prednalaganje v predpomnilnik
  let hidden = null;
  try {
    hidden = new BrowserWindow({
      show: false,
      width: 400,
      height: 300,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: 'persist:browser',
        backgroundThrottling: true,
        images: true
      }
    });
  } catch (e) {
    return;
  }

  let idx = 0;
  const loadNext = () => {
    if (!settings.preloadBookmarks || idx >= toPreload.length || !hidden || hidden.isDestroyed()) {
      try { if (hidden && !hidden.isDestroyed()) hidden.close(); } catch (e) {}
      return;
    }
    const url = toPreload[idx].url;
    idx++;
    if (!url || !url.startsWith('http')) {
      setTimeout(loadNext, 300);
      return;
    }
    hidden.loadURL(url).then(() => {
      setTimeout(loadNext, 1500); // počakaj da se viri naložijo v cache
    }).catch(() => {
      setTimeout(loadNext, 500);
    });
  };
  loadNext();
}

// Lazy-load slik – injiciraj CSS/JS ob nalaganju strani
function injectLazyImages(webContents) {
  if (!settings.lazyImages) return;
  const script = `
    (function() {
      if (window.__triglavLazy) return;
      window.__triglavLazy = true;
      try {
        const style = document.createElement('style');
        style.textContent = 'img[data-triglav-lazy]{content-visibility:auto;contain-intrinsic-size:1px 200px;}';
        (document.head || document.documentElement).appendChild(style);

        const upgrade = () => {
          document.querySelectorAll('img:not([loading])').forEach(img => {
            if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
            if (!img.hasAttribute('decoding')) img.setAttribute('decoding', 'async');
            img.setAttribute('data-triglav-lazy', '1');
          });
        };
        upgrade();
        const obs = new MutationObserver(upgrade);
        obs.observe(document.documentElement, { childList: true, subtree: true });
      } catch (e) {}
    })();
  `;
  webContents.executeJavaScript(script, true).catch(() => {});
}



function resolveTheme() {
  let theme = settings.theme || 'dark';
  if (theme === 'system') {
    theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }
  return theme;
}

function windowBackgroundColor() {
  const theme = resolveTheme();
  const backgrounds = {
    dark: '#0f1115',
    light: '#f0f2f5',
    midnight: '#0a0e17',
    ocean: '#0b1a2b',
    slate: '#1c1f26'
  };
  // backgroundStyle: 'default' | 'midnight' | 'ocean' | 'slate' (samo za temno)
  if (theme === 'light') return backgrounds.light;
  const style = settings.backgroundStyle || 'default';
  if (style === 'midnight') return backgrounds.midnight;
  if (style === 'ocean') return backgrounds.ocean;
  if (style === 'slate') return backgrounds.slate;
  return backgrounds.dark;
}

function applyThemeToWindow() {
  const theme = resolveTheme();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(windowBackgroundColor());
    mainWindow.webContents.send('theme-changed', theme);
    mainWindow.webContents.send('settings-updated', settings);
  }
}


function addToHistory(url, title) {
  if (!url || url.startsWith('about:') || url === 'about:blank') return;
  // Odstrani morebitni obstojeci zapis istega URL
  history = history.filter(h => h.url !== url);
  history.unshift({
    url,
    title: title || url,
    timestamp: Date.now()
  });
  if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
  saveHistory();
}

// ========== Pomožne funkcije ==========
function createBrowserView() {
  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      partition: 'persist:browser',
      spellcheck: false,
      backgroundThrottling: false,
      plugins: true,
      webgl: true,
      enableWebSQL: false,
      v8CacheOptions: 'code',
      // Omogoči funkcije, ki jih potrebujejo YouTube, Google ...
      additionalArguments: ['--enable-features=SharedArrayBuffer']
    }
  });

  // Modern Chrome UA (boljša združljivost + manj "stari brskalnik" omejitev)
  try {
    const chromeVer = process.versions.chrome || '130.0.0.0';
    view.webContents.setUserAgent(
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`
    );
  } catch (e) {}

  view.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      view.webContents.toggleDevTools();
    }
  });

  // Celozaslonski način (HTML5) – razširi BrowserView čez celo okno
  // To reši YouTube klepet / kontrolnike v fullscreen
  view.webContents.on('enter-html-full-screen', () => {
    if (!mainWindow) return;
    const [width, height] = mainWindow.getContentSize();
    view.setBounds({ x: 0, y: 0, width, height });
    view.setAutoResize({ width: true, height: true });
  });

  view.webContents.on('leave-html-full-screen', () => {
    updateViewBounds();
  });

  // Prenosi
  view.webContents.session.on('will-download', (event, item, webContents) => {
    const fileName = item.getFilename();
    mainWindow?.webContents.send('download-started', { fileName, url: item.getURL() });

    item.on('updated', (e, state) => {
      if (state === 'progressing') {
        const received = item.getReceivedBytes();
        const total = item.getTotalBytes();
        mainWindow?.webContents.send('download-progress', {
          fileName,
          received,
          total,
          percent: total > 0 ? Math.round((received / total) * 100) : 0
        });
      }
    });

    item.once('done', (e, state) => {
      mainWindow?.webContents.send('download-done', {
        fileName,
        state, // 'completed' | 'cancelled' | 'interrupted'
        path: item.getSavePath()
      });
    });
  });

  return view;
}

function getActiveTab() {
  return tabs.find(t => t.id === activeTabId) || null;
}

function getChromeHeight() {
  // tab bar (40) + toolbar (50) + bookmarks bar (34 if visible)
  return 90 + (settings.showBookmarksBar ? 34 : 0);
}

function updateViewBounds() {
  if (!mainWindow) return;
  const [width, height] = mainWindow.getContentSize();
  const chromeHeight = getChromeHeight();

  tabs.forEach(tab => {
    if (tab.id === activeTabId) {
      tab.view.setBounds({ x: 0, y: chromeHeight, width, height: height - chromeHeight });
      tab.view.setAutoResize({ width: true, height: true });
    }
  });
}

function sendTabsUpdate() {
  if (!mainWindow) return;
  const tabsData = tabs.map(t => ({
    id: t.id,
    title: t.title || 'Nov zavihek',
    url: t.url || 'about:blank',
    favicon: t.favicon || null,
    active: t.id === activeTabId
  }));
  mainWindow.webContents.send('tabs-updated', tabsData);
}

function createTab(url = HOME_URL, activate = true) {
  const id = nextTabId++;
  const view = createBrowserView();

  const tab = {
    id,
    view,
    title: 'Nalagam...',
    url: url,
    favicon: null
  };

  tabs.push(tab);

  view.webContents.on('page-title-updated', (e, title) => {
    tab.title = title;
    sendTabsUpdate();
    if (tab.id === activeTabId && mainWindow) {
      mainWindow.setTitle(`${title} – Triglav`);
    }
  });

  view.webContents.on('page-favicon-updated', (e, favicons) => {
    if (favicons && favicons.length > 0) {
      tab.favicon = favicons[0];
      sendTabsUpdate();
    }
  });

  view.webContents.on('did-navigate', (e, navigatedUrl) => {
    tab.url = navigatedUrl;
    sendTabsUpdate();
    addToHistory(navigatedUrl, tab.title);
    if (tab.id === activeTabId) {
      mainWindow.webContents.send('url-updated', navigatedUrl);
      mainWindow.webContents.send('navigation-state', {
        canGoBack: view.webContents.canGoBack(),
        canGoForward: view.webContents.canGoForward()
      });
      mainWindow.webContents.send('bookmark-state', isBookmarked(navigatedUrl));
    }
  });

  view.webContents.on('did-navigate-in-page', (e, navigatedUrl) => {
    tab.url = navigatedUrl;
    if (tab.id === activeTabId) {
      mainWindow.webContents.send('url-updated', navigatedUrl);
      mainWindow.webContents.send('bookmark-state', isBookmarked(navigatedUrl));
    }
  });

  view.webContents.on('did-start-loading', () => {
    if (tab.id === activeTabId) {
      mainWindow.webContents.send('loading', true);
    }
  });

  view.webContents.on('did-stop-loading', () => {
    if (tab.id === activeTabId) {
      mainWindow.webContents.send('loading', false);
      mainWindow.webContents.send('navigation-state', {
        canGoBack: view.webContents.canGoBack(),
        canGoForward: view.webContents.canGoForward()
      });
    }
  });

  view.webContents.on('dom-ready', () => {
    injectLazyImages(view.webContents);
  });

  view.webContents.on('did-finish-load', () => {
    injectLazyImages(view.webContents);
  });

  view.webContents.setWindowOpenHandler(({ url, frameName, features, disposition }) => {
    // about:blank / prazni popupi – dovoljeni (nekateri siti, vklj. YouTube)
    if (!url || url === 'about:blank') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 480,
          height: 720,
          autoHideMenuBar: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            partition: 'persist:browser'
          }
        }
      };
    }
    // Cilj _blank z disposition – nov zavihek
    createTab(url, true);
    return { action: 'deny' };
  });

  // Omogoči fullscreen API in piše
  view.webContents.session.setPermissionCheckHandler((wc, permission) => {
    const allowed = [
      'notifications', 'fullscreen', 'media', 'geolocation',
      'pointerLock', 'clipboard-read', 'clipboard-sanitized-write',
      'openExternal'
    ];
    return allowed.includes(permission);
  });

  if (url && url !== 'about:blank') {
    view.webContents.loadURL(url).catch(err => console.error('Failed to load URL:', err));
  }

  if (activate) {
    switchToTab(id);
  } else {
    sendTabsUpdate();
  }

  return id;
}

function switchToTab(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab || !mainWindow) return;

  tabs.forEach(t => {
    if (t.id !== id) {
      mainWindow.removeBrowserView(t.view);
    }
  });

  activeTabId = id;
  mainWindow.setBrowserView(tab.view);
  updateViewBounds();

  mainWindow.setTitle(`${tab.title || 'Nov zavihek'} – Triglav`);
  mainWindow.webContents.send('url-updated', tab.url || '');
  mainWindow.webContents.send('navigation-state', {
    canGoBack: tab.view.webContents.canGoBack(),
    canGoForward: tab.view.webContents.canGoForward()
  });
  mainWindow.webContents.send('loading', tab.view.webContents.isLoading());
  mainWindow.webContents.send('bookmark-state', isBookmarked(tab.url));

  sendTabsUpdate();
}

function closeTab(id) {
  const index = tabs.findIndex(t => t.id === id);
  if (index === -1) return;

  const tab = tabs[index];
  mainWindow.removeBrowserView(tab.view);
  tab.view.webContents.destroy();
  tabs.splice(index, 1);

  if (tabs.length === 0) {
    createTab(HOME_URL, true);
    return;
  }

  if (activeTabId === id) {
    const newIndex = Math.min(index, tabs.length - 1);
    switchToTab(tabs[newIndex].id);
  } else {
    sendTabsUpdate();
  }
}

function isBookmarked(url) {
  return bookmarks.some(b => b.url === url);
}

// ========== Ustvarjanje glavnega okna ==========
function createWindow() {
  mainWindow = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: 800,
    minHeight: 500,
    title: 'Triglav',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: windowBackgroundColor(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
      spellcheck: false
    },
    show: false,
    autoHideMenuBar: true,
    // Hitrejši prvi prikaz
    paintWhenInitiallyHidden: true
  });

  // Ko okno gre v OS fullscreen, prilagodi view
  mainWindow.on('enter-full-screen', () => {
    const tab = getActiveTab();
    if (tab && mainWindow) {
      const [width, height] = mainWindow.getContentSize();
      tab.view.setBounds({ x: 0, y: 0, width, height });
    }
  });
  mainWindow.on('leave-full-screen', () => {
    updateViewBounds();
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Pošlji začetne podatke
    mainWindow.webContents.send('theme-changed', resolveTheme());
    mainWindow.webContents.send('bookmarks-updated', bookmarks);
    mainWindow.webContents.send('settings-updated', settings);
    createTab(HOME_URL, true);
  });

  mainWindow.on('resize', updateViewBounds);
  mainWindow.on('maximize', updateViewBounds);
  mainWindow.on('unmaximize', updateViewBounds);

  mainWindow.on('closed', () => {
    tabs.forEach(t => {
      try { t.view.webContents.destroy(); } catch (e) {}
    });
    tabs = [];
    mainWindow = null;
  });

  // Meni
  const template = [
    {
      label: 'Datoteka',
      submenu: [
        { label: 'Nov zavihek', accelerator: 'CmdOrCtrl+T', click: () => createTab(HOME_URL, true) },
        { label: 'Zapri zavihek', accelerator: 'CmdOrCtrl+W', click: () => closeTab(activeTabId) },
        { type: 'separator' },
        { label: 'Izhod', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    },
    {
      label: 'Uredi',
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'Pogled',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Preklopi temo',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => {
            const order = ['dark', 'light', 'system'];
            const i = order.indexOf(settings.theme);
            settings.theme = order[(i + 1) % order.length];
            saveSettings();
            applyThemeToWindow();
          }
        }
      ]
    },
    {
      label: 'Zaznamki',
      submenu: [
        {
          label: 'Dodaj trenutno stran',
          accelerator: 'CmdOrCtrl+D',
          click: () => {
            const tab = getActiveTab();
            if (tab && tab.url) {
              toggleBookmark(tab.url, tab.title);
            }
          }
        },
        {
          label: 'Prikaži zaznamke',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => mainWindow.webContents.send('show-panel', 'bookmarks')
        },
        {
          label: 'Prikaži/skrij vrstico z zaznamki',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => {
            settings.showBookmarksBar = !settings.showBookmarksBar;
            saveSettings();
            mainWindow.webContents.send('settings-updated', settings);
            updateViewBounds();
          }
        },
        { type: 'separator' },
        {
          label: 'Uvozi zaznamke…',
          click: async () => {
            // Klic preko IPC handlerja (definiran spodaj)
            const result = await (async () => {
              const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
                title: 'Uvozi zaznamke (HTML iz Chrome / Firefox / Edge)',
                filters: [
                  { name: 'HTML zaznamki', extensions: ['html', 'htm'] },
                  { name: 'Vse datoteke', extensions: ['*'] }
                ],
                properties: ['openFile']
              });
              if (canceled || !filePaths?.[0]) return null;

              try {
                const html = fs.readFileSync(filePaths[0], 'utf8');
                const parsed = parseNetscapeBookmarks(html);
                const existingUrls = new Set(bookmarks.map(b => b.url));
                let imported = 0, skipped = 0;
                for (const item of parsed) {
                  if (existingUrls.has(item.url)) skipped++;
                  else {
                    bookmarks.push(item);
                    existingUrls.add(item.url);
                    imported++;
                  }
                }
                if (imported > 0) {
                  saveBookmarks();
                  mainWindow.webContents.send('bookmarks-updated', bookmarks);
                }
                return { imported, skipped, total: parsed.length };
              } catch (err) {
                return { error: err.message };
              }
            })();

            if (result) {
              if (result.error) {
                dialog.showErrorBox('Napaka pri uvozu', result.error);
              } else {
                dialog.showMessageBox(mainWindow, {
                  type: 'info',
                  title: 'Uvoz končan',
                  message: `Uvoženih: ${result.imported}`,
                  detail: result.skipped > 0
                    ? `Preskočenih (že obstajajo): ${result.skipped}\nSkupaj v datoteki: ${result.total}`
                    : `Skupaj v datoteki: ${result.total}`
                });
              }
            }
          }
        },
        {
          label: 'Izvozi zaznamke…',
          click: async () => {
            const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
              title: 'Izvozi zaznamke',
              defaultPath: 'zaznamki.html',
              filters: [{ name: 'HTML', extensions: ['html'] }]
            });
            if (canceled || !filePath) return;

            const lines = [
              '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
              '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
              '<TITLE>Bookmarks</TITLE>',
              '<H1>Bookmarks</H1>',
              '<DL><p>'
            ];
            for (const b of bookmarks) {
              const title = (b.title || b.url).replace(/</g, '&lt;').replace(/>/g, '&gt;');
              lines.push(`    <DT><A HREF="${b.url}">${title}</A>`);
            }
            lines.push('</DL><p>');
            fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Izvoz končan',
              message: `Zaznamki shranjeni v:\n${filePath}`
            });
          }
        }
      ]
    },
    {
      label: 'Zgodovina',
      submenu: [
        {
          label: 'Prikaži zgodovino',
          accelerator: 'CmdOrCtrl+H',
          click: () => mainWindow.webContents.send('show-panel', 'history')
        },
        {
          label: 'Počisti zgodovino',
          click: () => {
            history = [];
            saveHistory();
            mainWindow.webContents.send('history-updated', history);
          }
        }
      ]
    },
    {
      label: 'Pomagaj',
      submenu: [
        {
          label: 'O brskalniku',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'O Triglavu',
              message: 'Triglav v1.2',
              detail: 'Slovenski spletni brskalnik.\nZavihki • Zaznamki • Zgodovina • Teme • Prenosi\n\nPoimenovan po najvišji slovenski gori.',
              icon: nativeImage.createFromPath(path.join(__dirname, 'icon.png'))
            });
          }
        }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function toggleBookmark(url, title) {
  const existing = bookmarks.findIndex(b => b.url === url);
  if (existing >= 0) {
    bookmarks.splice(existing, 1);
  } else {
    bookmarks.unshift({
      url,
      title: title || url,
      favicon: getActiveTab()?.favicon || null,
      addedAt: Date.now()
    });
  }
  saveBookmarks();
  mainWindow?.webContents.send('bookmarks-updated', bookmarks);
  mainWindow?.webContents.send('bookmark-state', isBookmarked(url));
}

// ========== IPC handleri ==========
ipcMain.handle('navigate', async (event, url) => {
  const tab = getActiveTab();
  if (!tab) return;

  let finalUrl = url.trim();
  if (!finalUrl) return;

  if (!/^https?:\/\//i.test(finalUrl) && !finalUrl.startsWith('about:')) {
    if (!finalUrl.includes('.') || finalUrl.includes(' ')) {
      finalUrl = 'https://www.google.com/search?q=' + encodeURIComponent(finalUrl);
    } else {
      finalUrl = 'https://' + finalUrl;
    }
  }

  try {
    await tab.view.webContents.loadURL(finalUrl);
  } catch (err) {
    console.error(err);
  }
});

ipcMain.handle('go-back', () => {
  const tab = getActiveTab();
  if (tab && tab.view.webContents.canGoBack()) tab.view.webContents.goBack();
});

ipcMain.handle('go-forward', () => {
  const tab = getActiveTab();
  if (tab && tab.view.webContents.canGoForward()) tab.view.webContents.goForward();
});

ipcMain.handle('reload', () => {
  const tab = getActiveTab();
  if (tab) tab.view.webContents.reload();
});

ipcMain.handle('go-home', () => {
  const tab = getActiveTab();
  if (tab) tab.view.webContents.loadURL(HOME_URL);
});

ipcMain.handle('new-tab', (event, url) => createTab(url || HOME_URL, true));
ipcMain.handle('close-tab', (event, id) => closeTab(id || activeTabId));
ipcMain.handle('switch-tab', (event, id) => switchToTab(id));

ipcMain.handle('get-tabs', () => {
  return tabs.map(t => ({
    id: t.id,
    title: t.title || 'Nov zavihek',
    url: t.url || 'about:blank',
    favicon: t.favicon || null,
    active: t.id === activeTabId
  }));
});

// Zaznamki
ipcMain.handle('toggle-bookmark', () => {
  const tab = getActiveTab();
  if (tab && tab.url) {
    toggleBookmark(tab.url, tab.title);
  }
});

ipcMain.handle('get-bookmarks', () => bookmarks);

ipcMain.handle('remove-bookmark', (event, url) => {
  bookmarks = bookmarks.filter(b => b.url !== url);
  saveBookmarks();
  mainWindow?.webContents.send('bookmarks-updated', bookmarks);
  const tab = getActiveTab();
  if (tab) mainWindow?.webContents.send('bookmark-state', isBookmarked(tab.url));
});

ipcMain.handle('open-bookmark', (event, url) => {
  createTab(url, true);
});

// Zgodovina
ipcMain.handle('get-history', () => history);

ipcMain.handle('clear-history', () => {
  history = [];
  saveHistory();
  mainWindow?.webContents.send('history-updated', history);
});

ipcMain.handle('open-history-item', (event, url) => {
  createTab(url, true);
});

// Tema
ipcMain.handle('get-theme', () => settings.theme);

ipcMain.handle('toggle-theme', () => {
  // Ciklično: dark -> light -> system -> dark
  const order = ['dark', 'light', 'system'];
  const i = order.indexOf(settings.theme);
  settings.theme = order[(i + 1) % order.length];
  saveSettings();
  applyThemeToWindow();
  return settings.theme;
});

// Vrstica z zaznamki
ipcMain.handle('get-settings', () => settings);

// Nastavitve hitrosti
ipcMain.handle('update-setting', (event, key, value) => {
  const allowed = ['blockTrackers', 'lazyImages', 'preloadBookmarks', 'showBookmarksBar', 'theme', 'backgroundStyle'];
  if (!allowed.includes(key)) return settings;
  settings[key] = value;
  saveSettings();
  if (key === 'theme' || key === 'backgroundStyle') {
    applyThemeToWindow();
  } else {
    mainWindow?.webContents.send('settings-updated', settings);
  }
  if (key === 'preloadBookmarks' && value) scheduleBookmarkPreload();
  return settings;
});


ipcMain.handle('toggle-bookmarks-bar', () => {
  settings.showBookmarksBar = !settings.showBookmarksBar;
  saveSettings();
  mainWindow?.webContents.send('settings-updated', settings);
  updateViewBounds();
  return settings.showBookmarksBar;
});

// Uvoz zaznamkov (Netscape Bookmark HTML – Chrome, Firefox, Edge, Safari…)
function parseNetscapeBookmarks(html) {
  const results = [];
  // <A HREF="url" ...>title</A>
  const re = /<A\s+[^>]*HREF\s*=\s*["']([^"']+)["'][^>]*>([^<]*)<\/A>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = m[1].trim();
    const title = (m[2] || url).trim();
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      results.push({ url, title: title || url, favicon: null, addedAt: Date.now() });
    }
  }
  return results;
}

ipcMain.handle('import-bookmarks', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Uvozi zaznamke',
    filters: [
      { name: 'HTML zaznamki (Chrome, Firefox, Edge…)', extensions: ['html', 'htm'] },
      { name: 'Vse datoteke', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (canceled || !filePaths || !filePaths[0]) {
    return { imported: 0, skipped: 0 };
  }

  try {
    const html = fs.readFileSync(filePaths[0], 'utf8');
    const parsed = parseNetscapeBookmarks(html);
    const existingUrls = new Set(bookmarks.map(b => b.url));
    let imported = 0;
    let skipped = 0;

    for (const item of parsed) {
      if (existingUrls.has(item.url)) {
        skipped++;
      } else {
        bookmarks.push(item);
        existingUrls.add(item.url);
        imported++;
      }
    }

    if (imported > 0) {
      saveBookmarks();
      mainWindow?.webContents.send('bookmarks-updated', bookmarks);
    }

    return { imported, skipped, total: parsed.length };
  } catch (err) {
    console.error('Import failed:', err);
    return { imported: 0, skipped: 0, error: err.message };
  }
});

ipcMain.handle('export-bookmarks', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Izvozi zaznamke',
    defaultPath: 'zaznamki.html',
    filters: [{ name: 'HTML', extensions: ['html'] }]
  });

  if (canceled || !filePath) return { ok: false };

  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file. -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>'
  ];

  for (const b of bookmarks) {
    const title = (b.title || b.url).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    lines.push(`    <DT><A HREF="${b.url}">${title}</A>`);
  }
  lines.push('</DL><p>');

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return { ok: true, path: filePath };
});

// ========== App lifecycle ==========
app.setName('Triglav');

app.whenReady().then(() => {
  // Ikona aplikacije (Linux/Windows)
  try {
    const iconPath = path.join(__dirname, 'icon.png');
    if (process.platform === 'linux') {
      // na Linuxu se ikona okna nastavi preko BrowserWindow
    }
  } catch (e) {}

  loadData();

  // Predpomnilnik, sledilniki, dovoljenja
  const ses = session.fromPartition('persist:browser');
  setupSessionPerformance(ses);
  setupSessionPerformance(session.defaultSession);

  const permHandler = (webContents, permission, callback) => {
    const allowed = [
      'notifications', 'fullscreen', 'media', 'geolocation',
      'pointerLock', 'clipboard-read', 'clipboard-sanitized-write',
      'display-capture', 'id-token', 'storage-access'
    ];
    callback(allowed.includes(permission));
  };
  session.defaultSession.setPermissionRequestHandler(permHandler);
  ses.setPermissionRequestHandler(permHandler);

  createWindow();

  // Prednalaganje zaznamkov v ozadju (po zagonu)
  scheduleBookmarkPreload();

  // Spremljaj sistemsko temo
  nativeTheme.on('updated', () => {
    if (settings.theme === 'system') applyThemeToWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
