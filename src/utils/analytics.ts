/**
 * Privacy-friendly analytics service using Plausible Analytics
 * GDPR compliant, no cookies, no personal data collection
 */

interface AnalyticsEvent {
  name: string;
  props?: Record<string, string | number | boolean>;
}

interface AnalyticsConfig {
  domain: string;
  apiEndpoint: string;
  enabled: boolean;
}

class AnalyticsService {
  private config: AnalyticsConfig;
  private extensionId: string;

  constructor() {
    this.extensionId = chrome?.runtime?.id || 'unknown';
    this.config = {
      domain: 'google-calendar-tools.chrome-extension',
      apiEndpoint: 'https://plausible.io/api/event',
      enabled: true // Can be controlled by user preferences
    };
  }

  /**
   * Track a custom event
   */
  async trackEvent(event: AnalyticsEvent): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      const payload = {
        name: event.name,
        url: `chrome-extension://${this.extensionId}/`,
        domain: this.config.domain,
        props: {
          ...event.props,
          extension_version: chrome?.runtime?.getManifest?.()?.version || 'unknown',
          user_agent: navigator.userAgent
        }
      };

      await fetch(this.config.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': navigator.userAgent
        },
        body: JSON.stringify(payload)
      });

      console.log('[Analytics] Event tracked:', event.name, event.props);
    } catch (error) {
      console.warn('[Analytics] Failed to track event:', error);
      // Fail silently to not impact user experience
    }
  }

  /**
   * Track extension installation/activation
   */
  async trackInstall(): Promise<void> {
    await this.trackEvent({
      name: 'extension_installed',
      props: {
        version: chrome?.runtime?.getManifest?.()?.version || 'unknown'
      }
    });
  }

  /**
   * Track page views (Google Calendar pages)
   */
  async trackPageView(page: string): Promise<void> {
    await this.trackEvent({
      name: 'pageview',
      props: {
        page: page
      }
    });
  }

  /**
   * Track feature usage
   */
  async trackFeatureUsage(feature: string, additionalProps?: Record<string, string | number | boolean>): Promise<void> {
    await this.trackEvent({
      name: 'feature_used',
      props: {
        feature: feature,
        ...additionalProps
      }
    });
  }

  /**
   * Track errors (without personal data)
   */
  async trackError(errorType: string, errorCode?: string): Promise<void> {
    await this.trackEvent({
      name: 'error_occurred',
      props: {
        error_type: errorType,
        error_code: errorCode || 'unknown'
      }
    });
  }

  /**
   * Enable or disable analytics
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Update analytics configuration
   */
  updateConfig(newConfig: Partial<AnalyticsConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
}

// Create a singleton instance
export const analytics = new AnalyticsService();

// Export types for use in other modules
export type { AnalyticsEvent, AnalyticsConfig }; 