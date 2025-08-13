/**
 * Debug mode controller for development and troubleshooting features
 */

export interface DebugConfig {
  enabled: boolean;
  showProfileDebugInfo: boolean;
  showConsoleVerbose: boolean;
  showParameterTracking: boolean;
  showPerformanceMetrics: boolean;
  showWorkerMessages: boolean;
}

const DEFAULT_CONFIG: DebugConfig = {
  enabled: false,
  showProfileDebugInfo: false,
  showConsoleVerbose: false,
  showParameterTracking: false,
  showPerformanceMetrics: false,
  showWorkerMessages: false
};

const STORAGE_KEY = 'imagetool.debug.config';

class DebugController {
  private config: DebugConfig;
  private listeners: Array<(config: DebugConfig) => void> = [];

  constructor() {
    this.config = this.loadConfig();
    
    // Enable debug mode via URL parameter or localStorage
    this.checkDebugFlags();
    
    console.log('[Debug] Controller initialized:', this.config);
  }

  private loadConfig(): DebugConfig {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch (e) {
      console.warn('[Debug] Failed to load config from localStorage:', e);
    }
    return { ...DEFAULT_CONFIG };
  }

  private saveConfig(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
    } catch (e) {
      console.warn('[Debug] Failed to save config to localStorage:', e);
    }
  }

  private checkDebugFlags(): void {
    // Check URL parameters
    const params = new URLSearchParams(window.location.search);
    const debugParam = params.get('debug');
    
    if (debugParam === 'true' || debugParam === '1') {
      this.config.enabled = true;
      this.config.showConsoleVerbose = true;
      console.log('[Debug] Enabled via URL parameter');
    }

    // Check for specific debug flags
    if (params.get('debug-profiles') === 'true') {
      this.config.showProfileDebugInfo = true;
    }
    if (params.get('debug-verbose') === 'true') {
      this.config.showConsoleVerbose = true;
    }
    if (params.get('debug-tracking') === 'true') {
      this.config.showParameterTracking = true;
    }
    if (params.get('debug-performance') === 'true') {
      this.config.showPerformanceMetrics = true;
    }
    if (params.get('debug-worker') === 'true') {
      this.config.showWorkerMessages = true;
    }

    // Check for localStorage debug flag
    const storedDebug = localStorage.getItem('imagetool.debug.enabled');
    if (storedDebug === 'true') {
      this.config.enabled = true;
    }

    // If any debug feature is enabled, enable debug mode
    if (Object.values(this.config).some(v => v === true)) {
      this.config.enabled = true;
    }

    this.saveConfig();
  }

  getConfig(): DebugConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<DebugConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...updates };
    
    // If debug mode is disabled, disable all sub-features
    if (!this.config.enabled) {
      this.config.showProfileDebugInfo = false;
      this.config.showConsoleVerbose = false;
      this.config.showParameterTracking = false;
      this.config.showPerformanceMetrics = false;
      this.config.showWorkerMessages = false;
    }

    this.saveConfig();
    
    // Notify listeners of config changes
    this.listeners.forEach(listener => {
      try {
        listener(this.config);
      } catch (e) {
        console.warn('[Debug] Listener error:', e);
      }
    });

    console.log('[Debug] Config updated:', { old: oldConfig, new: this.config });
  }

  subscribe(listener: (config: DebugConfig) => void): () => void {
    this.listeners.push(listener);
    
    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  // Convenience methods for checking specific debug features
  isEnabled(): boolean {
    return this.config.enabled;
  }

  shouldShowProfileDebugInfo(): boolean {
    return this.config.enabled && this.config.showProfileDebugInfo;
  }

  shouldShowConsoleVerbose(): boolean {
    return this.config.enabled && this.config.showConsoleVerbose;
  }

  shouldShowParameterTracking(): boolean {
    return this.config.enabled && this.config.showParameterTracking;
  }

  shouldShowPerformanceMetrics(): boolean {
    return this.config.enabled && this.config.showPerformanceMetrics;
  }

  shouldShowWorkerMessages(): boolean {
    return this.config.enabled && this.config.showWorkerMessages;
  }

  // Debug logging wrapper
  log(category: string, ...args: any[]): void {
    if (this.shouldShowConsoleVerbose()) {
      console.log(`[Debug:${category}]`, ...args);
    }
  }

  // Performance timing helper
  time(label: string): void {
    if (this.shouldShowPerformanceMetrics()) {
      console.time(`[Debug:Performance] ${label}`);
    }
  }

  timeEnd(label: string): void {
    if (this.shouldShowPerformanceMetrics()) {
      console.timeEnd(`[Debug:Performance] ${label}`);
    }
  }

  // Quick toggle for development
  toggleDebugMode(): void {
    this.updateConfig({ enabled: !this.config.enabled });
  }

  // Enable all debug features (for development)
  enableAll(): void {
    this.updateConfig({
      enabled: true,
      showProfileDebugInfo: true,
      showConsoleVerbose: true,
      showParameterTracking: true,
      showPerformanceMetrics: true,
      showWorkerMessages: true
    });
  }

  // Disable all debug features (for production)
  disableAll(): void {
    this.updateConfig({
      enabled: false,
      showProfileDebugInfo: false,
      showConsoleVerbose: false,
      showParameterTracking: false,
      showPerformanceMetrics: false,
      showWorkerMessages: false
    });
  }

  // Clear browser cache and site data
  clearBrowserCache(): void {
    try {
      // Clear localStorage
      const autoSaveKeys = [
        'imagetool.autoSave.dirName',
        'imagetool.autoSave.enabled'
      ];
      
      autoSaveKeys.forEach(key => {
        const oldValue = localStorage.getItem(key);
        localStorage.removeItem(key);
        if (oldValue) {
          console.log(`[Debug] Cleared localStorage: ${key} = ${oldValue}`);
        }
      });

      // Clear session storage
      sessionStorage.clear();
      console.log('[Debug] Session storage cleared');

      // Clear global handles
      if ((window as any).autoSaveHandle) {
        delete (window as any).autoSaveHandle;
        console.log('[Debug] Cleared autoSaveHandle');
      }
      
      if ((window as any).cachedParentHandle) {
        delete (window as any).cachedParentHandle;
        console.log('[Debug] Cleared cachedParentHandle');
      }

      console.log('[Debug] Browser cache clearing completed');
      alert('キャッシュをクリアしました。ページをリロードしてください。');
      
    } catch (e) {
      console.warn('[Debug] Failed to clear some cache data:', e);
    }
  }

  // Force reload with cache busting
  forceReload(): void {
    const timestamp = Date.now();
    const url = new URL(window.location.href);
    url.searchParams.set('t', timestamp.toString());
    
    console.log('[Debug] Force reloading with cache buster:', url.toString());
    window.location.href = url.toString();
  }

  // Reset all application state (cache + reload)
  resetApplication(): void {
    console.log('[Debug] Resetting application state...');
    this.clearBrowserCache();
    
    // Short delay to ensure cleanup completes
    setTimeout(() => {
      this.forceReload();
    }, 500);
  }
}

// Export singleton instance
export const debugController = new DebugController();

// Global debug helper (can be accessed from browser console)
if (typeof window !== 'undefined') {
  (window as any).debugController = debugController;
  (window as any).toggleDebug = () => debugController.toggleDebugMode();
  (window as any).enableAllDebug = () => debugController.enableAll();
  (window as any).disableAllDebug = () => debugController.disableAll();
  
  // Cache management functions
  (window as any).clearCache = () => debugController.clearBrowserCache();
  (window as any).forceReload = () => debugController.forceReload();
  (window as any).resetApp = () => debugController.resetApplication();
}