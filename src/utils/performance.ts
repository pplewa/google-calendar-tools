interface PerformanceMetric {
  name: string;
  value: number;
  unit: 'ms' | 'count' | 'bytes';
  timestamp: number;
  context?: Record<string, any>;
}

interface LongTaskEntry {
  duration: number;
  startTime: number;
  name: string;
  entryType: string;
}

interface PerformanceConfig {
  enableLongTaskDetection: boolean;
  enableMemoryTracking: boolean;
  enableDOMTimings: boolean;
  reportingInterval: number; // milliseconds
  batchSize: number;
  maxMetrics: number;
}

class PerformanceMonitor {
  private static instance: PerformanceMonitor | null = null;
  private metrics: PerformanceMetric[] = [];
  private config: PerformanceConfig;
  private longTaskObserver: PerformanceObserver | null = null;
  private measureObserver: PerformanceObserver | null = null;
  private reportingTimer: NodeJS.Timeout | null = null;
  private isInitialized = false;

  constructor(config: Partial<PerformanceConfig> = {}) {
    this.config = {
      enableLongTaskDetection: true,
      enableMemoryTracking: true,
      enableDOMTimings: true,
      reportingInterval: 30000, // 30 seconds
      batchSize: 10,
      maxMetrics: 100,
      ...config
    };
  }

  static getInstance(config?: Partial<PerformanceConfig>): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor(config);
    }
    return PerformanceMonitor.instance;
  }

  /**
   * Initialize performance monitoring
   */
  initialize(): void {
    if (this.isInitialized) {
      return;
    }

    try {
      this.setupLongTaskDetection();
      this.setupMeasureObserver();
      this.startPeriodicReporting();
      this.trackInitializationTime();
      this.isInitialized = true;
      console.log('PerformanceMonitor initialized');
    } catch (error) {
      console.warn('Failed to initialize PerformanceMonitor:', error);
    }
  }

  /**
   * Track extension initialization time
   */
  private trackInitializationTime(): void {
    const initTime = performance.now();
    this.addMetric({
      name: 'extension_init_time',
      value: initTime,
      unit: 'ms',
      timestamp: Date.now(),
      context: {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        url: typeof window !== 'undefined' ? window.location.href : 'background'
      }
    });
  }

  /**
   * Setup Long Task API to detect main thread blocking
   */
  private setupLongTaskDetection(): void {
    if (!this.config.enableLongTaskDetection || typeof window === 'undefined' || !('PerformanceObserver' in window)) {
      return;
    }

    try {
      this.longTaskObserver = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          const longTask = entry as any as LongTaskEntry;
          this.addMetric({
            name: 'long_task_detected',
            value: longTask.duration,
            unit: 'ms',
            timestamp: Date.now(),
            context: {
              startTime: longTask.startTime,
              url: typeof window !== 'undefined' ? window.location.href : 'background'
            }
          });
        }
      });

      this.longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch (error) {
      console.warn('Long task detection not supported:', error);
    }
  }

  /**
   * Setup observer for custom performance measures
   */
  private setupMeasureObserver(): void {
    if (typeof window === 'undefined' || !('PerformanceObserver' in window)) {
      return;
    }

    try {
      this.measureObserver = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          if (entry.name.startsWith('gct_')) { // Google Calendar Tools prefix
            this.addMetric({
              name: entry.name,
              value: entry.duration,
              unit: 'ms',
              timestamp: Date.now(),
              context: {
                startTime: entry.startTime,
                url: typeof window !== 'undefined' ? window.location.href : 'background'
              }
            });
          }
        }
      });

      this.measureObserver.observe({ entryTypes: ['measure'] });
    } catch (error) {
      console.warn('Measure observer not supported:', error);
    }
  }

  /**
   * Start a performance timing measurement
   */
  startTiming(name: string): string {
    const markName = `gct_${name}_start`;
    try {
      performance.mark(markName);
      return markName;
    } catch (error) {
      console.warn('Failed to start timing:', error);
      return markName;
    }
  }

  /**
   * End a performance timing measurement
   */
  endTiming(name: string, context?: Record<string, any>): number {
    const startMark = `gct_${name}_start`;
    const endMark = `gct_${name}_end`;
    const measureName = `gct_${name}`;

    try {
      performance.mark(endMark);
      performance.measure(measureName, startMark, endMark);
      
      const measure = performance.getEntriesByName(measureName)[0];
      const duration = measure ? measure.duration : 0;

      // Clean up marks to prevent memory leaks
      performance.clearMarks(startMark);
      performance.clearMarks(endMark);
      performance.clearMeasures(measureName);

      return duration;
    } catch (error) {
      console.warn('Failed to end timing:', error);
      return 0;
    }
  }

  /**
   * Time a function execution
   */
  async timeFunction<T>(
    name: string, 
    fn: () => T | Promise<T>, 
    context?: Record<string, any>
  ): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const duration = performance.now() - start;
      
      this.addMetric({
        name: `function_${name}`,
        value: duration,
        unit: 'ms',
        timestamp: Date.now(),
        context: {
          ...context,
          url: typeof window !== 'undefined' ? window.location.href : 'background'
        }
      });
      
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.addMetric({
        name: `function_${name}_error`,
        value: duration,
        unit: 'ms',
        timestamp: Date.now(),
        context: {
          ...context,
          error: error instanceof Error ? error.message : String(error),
          url: typeof window !== 'undefined' ? window.location.href : 'background'
        }
      });
      throw error;
    }
  }

  /**
   * Track DOM manipulation performance
   */
  trackDOMOperation(name: string, elementCount?: number, context?: Record<string, any>): void {
    if (!this.config.enableDOMTimings) {
      return;
    }

    this.addMetric({
      name: `dom_${name}`,
      value: elementCount || 1,
      unit: 'count',
      timestamp: Date.now(),
      context: {
        ...context,
        url: typeof window !== 'undefined' ? window.location.href : 'background'
      }
    });
  }

  /**
   * Track memory usage (indirect measurement)
   */
  trackMemoryUsage(operation: string, objectCount?: number, context?: Record<string, any>): void {
    if (!this.config.enableMemoryTracking) {
      return;
    }

    // Indirect memory tracking through object/array counts
    this.addMetric({
      name: `memory_${operation}`,
      value: objectCount || 0,
      unit: 'count',
      timestamp: Date.now(),
      context: {
        ...context,
        url: typeof window !== 'undefined' ? window.location.href : 'background'
      }
    });
  }

  /**
   * Track custom metric
   */
  trackMetric(name: string, value: number, unit: 'ms' | 'count' | 'bytes', context?: Record<string, any>): void {
    this.addMetric({
      name,
      value,
      unit,
      timestamp: Date.now(),
      context: {
        ...context,
        url: typeof window !== 'undefined' ? window.location.href : 'background'
      }
    });
  }

  /**
   * Add metric to internal storage
   */
  private addMetric(metric: PerformanceMetric): void {
    this.metrics.push(metric);
    
    // Prevent memory leaks by limiting stored metrics
    if (this.metrics.length > this.config.maxMetrics) {
      this.metrics = this.metrics.slice(-this.config.maxMetrics);
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): PerformanceMetric[] {
    return [...this.metrics];
  }

  /**
   * Clear all metrics
   */
  clearMetrics(): void {
    this.metrics = [];
  }

  /**
   * Start periodic reporting to analytics
   */
  private startPeriodicReporting(): void {
    this.reportingTimer = setInterval(() => {
      this.reportMetrics();
    }, this.config.reportingInterval);
  }

  /**
   * Report metrics to analytics service
   */
  private async reportMetrics(): Promise<void> {
    if (this.metrics.length === 0) {
      return;
    }

    try {
      // Import analytics dynamically to avoid circular dependencies
      const { analytics } = await import('./analytics');
      
      // Group metrics by type for efficient reporting
      const metricGroups = this.groupMetricsByType();
      
      for (const [type, metrics] of Array.from(metricGroups.entries())) {
        if (metrics.length > 0) {
          // Report aggregated metrics
          const avgValue = metrics.reduce((sum, m) => sum + m.value, 0) / metrics.length;
          const maxValue = Math.max(...metrics.map(m => m.value));
          const minValue = Math.min(...metrics.map(m => m.value));
          
          analytics.trackEvent({
            name: 'performance_metrics',
            props: {
              type,
              count: metrics.length,
              avgValue: Math.round(avgValue * 100) / 100,
              maxValue: Math.round(maxValue * 100) / 100,
              minValue: Math.round(minValue * 100) / 100,
              unit: metrics[0].unit,
              url: typeof window !== 'undefined' ? window.location.href : 'background'
            }
          });
        }
      }
      
      // Clear reported metrics
      this.clearMetrics();
      
    } catch (error) {
      console.warn('Failed to report performance metrics:', error);
    }
  }

  /**
   * Group metrics by type for aggregation
   */
  private groupMetricsByType(): Map<string, PerformanceMetric[]> {
    const groups = new Map<string, PerformanceMetric[]>();
    
    for (const metric of this.metrics) {
      const type = metric.name.split('_')[0]; // Get prefix (e.g., 'dom', 'function', 'long')
      if (!groups.has(type)) {
        groups.set(type, []);
      }
      groups.get(type)!.push(metric);
    }
    
    return groups;
  }

  /**
   * Get performance summary for debugging
   */
  getSummary(): Record<string, any> {
    const groups = this.groupMetricsByType();
    const summary: Record<string, any> = {};
    
    for (const [type, metrics] of Array.from(groups.entries())) {
      summary[type] = {
        count: metrics.length,
        avgValue: metrics.reduce((sum, m) => sum + m.value, 0) / metrics.length,
        maxValue: Math.max(...metrics.map(m => m.value)),
        minValue: Math.min(...metrics.map(m => m.value))
      };
    }
    
    return summary;
  }

  /**
   * Cleanup and stop monitoring
   */
  cleanup(): void {
    if (this.longTaskObserver) {
      this.longTaskObserver.disconnect();
      this.longTaskObserver = null;
    }
    
    if (this.measureObserver) {
      this.measureObserver.disconnect();
      this.measureObserver = null;
    }
    
    if (this.reportingTimer) {
      clearInterval(this.reportingTimer);
      this.reportingTimer = null;
    }
    
    this.reportMetrics(); // Final report
    this.isInitialized = false;
  }
}

// Export singleton instance
export const performanceMonitor = PerformanceMonitor.getInstance();

// Export types for external usage
export type { PerformanceMetric, PerformanceConfig }; 