/**
 * Parameter export utility for tracking user edits and learning patterns
 */

export interface ParameterEditEvent {
  timestamp: number;
  imageSize: { width: number; height: number };
  initialBBox: [number, number, number, number];
  finalBBox: [number, number, number, number];
  selectedProfile: string;
  adjustmentType: 'position' | 'size' | 'both';
  sessionId: string;
}

export interface ParameterExportConfig {
  enableLocalStorage: boolean;
  enableGA4: boolean;
  maxStoredEvents: number;
}

const DEFAULT_CONFIG: ParameterExportConfig = {
  enableLocalStorage: true,
  enableGA4: false,
  maxStoredEvents: 1000
};

class ParameterExporter {
  private config: ParameterExportConfig;
  private sessionId: string;
  private storageKey = 'imagetool.parameterEdits';

  constructor(config: Partial<ParameterExportConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessionId = this.generateSessionId();
    console.log('[ParameterExporter] Initialized with session:', this.sessionId);
  }

  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private calculateAdjustmentType(
    initial: [number, number, number, number],
    final: [number, number, number, number]
  ): 'position' | 'size' | 'both' {
    const [ix, iy, iw, ih] = initial;
    const [fx, fy, fw, fh] = final;
    
    const positionChanged = ix !== fx || iy !== fy;
    const sizeChanged = iw !== fw || ih !== fh;
    
    if (positionChanged && sizeChanged) return 'both';
    if (positionChanged) return 'position';
    if (sizeChanged) return 'size';
    return 'position'; // Default fallback
  }

  exportEditEvent(
    imageSize: { width: number; height: number },
    initialBBox: [number, number, number, number],
    finalBBox: [number, number, number, number],
    selectedProfile: string
  ): void {
    // Skip if no actual change occurred
    if (this.arraysEqual(initialBBox, finalBBox)) {
      return;
    }

    const event: ParameterEditEvent = {
      timestamp: Date.now(),
      imageSize,
      initialBBox,
      finalBBox,
      selectedProfile,
      adjustmentType: this.calculateAdjustmentType(initialBBox, finalBBox),
      sessionId: this.sessionId
    };

    console.log('[ParameterExporter] Exporting edit event:', event);

    if (this.config.enableLocalStorage) {
      this.saveToLocalStorage(event);
    }

    if (this.config.enableGA4) {
      this.sendToGA4(event);
    }
  }

  private arraysEqual(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((val, index) => val === b[index]);
  }

  private saveToLocalStorage(event: ParameterEditEvent): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      const events: ParameterEditEvent[] = stored ? JSON.parse(stored) : [];
      
      events.push(event);
      
      // Keep only the most recent events to prevent storage bloat
      if (events.length > this.config.maxStoredEvents) {
        events.splice(0, events.length - this.config.maxStoredEvents);
      }
      
      localStorage.setItem(this.storageKey, JSON.stringify(events));
      console.log('[ParameterExporter] Saved to localStorage. Total events:', events.length);
    } catch (e) {
      console.warn('[ParameterExporter] Failed to save to localStorage:', e);
    }
  }

  private sendToGA4(event: ParameterEditEvent): void {
    try {
      // Check if GA4 is available
      if (typeof window !== 'undefined' && (window as any).gtag) {
        (window as any).gtag('event', 'parameter_edit', {
          custom_parameter_timestamp: event.timestamp,
          custom_parameter_image_width: event.imageSize.width,
          custom_parameter_image_height: event.imageSize.height,
          custom_parameter_adjustment_type: event.adjustmentType,
          custom_parameter_selected_profile: event.selectedProfile,
          custom_parameter_session_id: event.sessionId,
          // Note: GA4 has limits on parameter names and values
          // Complex data like bbox coordinates would need to be serialized
          custom_parameter_bbox_change: `${event.initialBBox.join(',')}->${event.finalBBox.join(',')}`
        });
        console.log('[ParameterExporter] Sent to GA4:', event);
      } else {
        console.log('[ParameterExporter] GA4 not available, skipping GA4 export');
      }
    } catch (e) {
      console.warn('[ParameterExporter] Failed to send to GA4:', e);
    }
  }

  getStoredEvents(): ParameterEditEvent[] {
    try {
      const stored = localStorage.getItem(this.storageKey);
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.warn('[ParameterExporter] Failed to retrieve stored events:', e);
      return [];
    }
  }

  clearStoredEvents(): void {
    try {
      localStorage.removeItem(this.storageKey);
      console.log('[ParameterExporter] Cleared stored events');
    } catch (e) {
      console.warn('[ParameterExporter] Failed to clear stored events:', e);
    }
  }

  getEventsSummary(): {
    totalEvents: number;
    sessionCount: number;
    adjustmentTypes: Record<string, number>;
    profileUsage: Record<string, number>;
  } {
    const events = this.getStoredEvents();
    const sessions = new Set(events.map(e => e.sessionId));
    const adjustmentTypes = events.reduce((acc, e) => {
      acc[e.adjustmentType] = (acc[e.adjustmentType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const profileUsage = events.reduce((acc, e) => {
      acc[e.selectedProfile] = (acc[e.selectedProfile] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalEvents: events.length,
      sessionCount: sessions.size,
      adjustmentTypes,
      profileUsage
    };
  }
}

// Export singleton instance
export const parameterExporter = new ParameterExporter();

// Export configuration function for customization
export function configureParameterExporter(config: Partial<ParameterExportConfig>): void {
  (parameterExporter as any).config = { ...DEFAULT_CONFIG, ...config };
  console.log('[ParameterExporter] Configuration updated:', (parameterExporter as any).config);
}