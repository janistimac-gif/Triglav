const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browserAPI', {
  // Navigacija
  navigate: (url) => ipcRenderer.invoke('navigate', url),
  goBack: () => ipcRenderer.invoke('go-back'),
  goForward: () => ipcRenderer.invoke('go-forward'),
  reload: () => ipcRenderer.invoke('reload'),
  goHome: () => ipcRenderer.invoke('go-home'),

  // Zavihki
  newTab: (url) => ipcRenderer.invoke('new-tab', url),
  closeTab: (id) => ipcRenderer.invoke('close-tab', id),
  switchTab: (id) => ipcRenderer.invoke('switch-tab', id),
  getTabs: () => ipcRenderer.invoke('get-tabs'),

  // Zaznamki
  toggleBookmark: () => ipcRenderer.invoke('toggle-bookmark'),
  getBookmarks: () => ipcRenderer.invoke('get-bookmarks'),
  removeBookmark: (url) => ipcRenderer.invoke('remove-bookmark', url),
  openBookmark: (url) => ipcRenderer.invoke('open-bookmark', url),
  importBookmarks: () => ipcRenderer.invoke('import-bookmarks'),
  exportBookmarks: () => ipcRenderer.invoke('export-bookmarks'),

  // Zgodovina
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  openHistoryItem: (url) => ipcRenderer.invoke('open-history-item', url),

  // Tema & nastavitve
  getTheme: () => ipcRenderer.invoke('get-theme'),
  toggleTheme: () => ipcRenderer.invoke('toggle-theme'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  toggleBookmarksBar: () => ipcRenderer.invoke('toggle-bookmarks-bar'),
  updateSetting: (key, value) => ipcRenderer.invoke('update-setting', key, value),

  // Dogodki iz main procesa
  onTabsUpdated: (cb) => ipcRenderer.on('tabs-updated', (e, data) => cb(data)),
  onUrlUpdated: (cb) => ipcRenderer.on('url-updated', (e, url) => cb(url)),
  onNavigationState: (cb) => ipcRenderer.on('navigation-state', (e, state) => cb(state)),
  onLoading: (cb) => ipcRenderer.on('loading', (e, isLoading) => cb(isLoading)),
  onBookmarkState: (cb) => ipcRenderer.on('bookmark-state', (e, isBookmarked) => cb(isBookmarked)),
  onBookmarksUpdated: (cb) => ipcRenderer.on('bookmarks-updated', (e, bookmarks) => cb(bookmarks)),
  onHistoryUpdated: (cb) => ipcRenderer.on('history-updated', (e, history) => cb(history)),
  onThemeChanged: (cb) => ipcRenderer.on('theme-changed', (e, theme) => cb(theme)),
  onSettingsUpdated: (cb) => ipcRenderer.on('settings-updated', (e, settings) => cb(settings)),
  onShowPanel: (cb) => ipcRenderer.on('show-panel', (e, panel) => cb(panel)),
  onDownloadStarted: (cb) => ipcRenderer.on('download-started', (e, data) => cb(data)),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (e, data) => cb(data)),
  onDownloadDone: (cb) => ipcRenderer.on('download-done', (e, data) => cb(data))
});
