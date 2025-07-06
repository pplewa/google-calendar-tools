/**
 * Google Calendar Tools - Content Script
 * Enhances Google Calendar with productivity tools
 */

interface CalendarExtension {
  initialized: boolean;
  observer: MutationObserver | null;
  cleanup: () => void;
}

interface EventCard {
  element: HTMLElement;
  eventId: string;
  hasCustomUI: boolean;
  lastSeen: number; // Timestamp for health checking
}

interface ExtensionHealth {
  isHealthy: boolean;
  lastHealthCheck: number;
  errorCount: number;
  totalEnhanced: number;
  failedEnhancements: number;
}

interface EventDetails {
  id: string;
  title: string;
  startDateTime: Date | null;
  endDateTime: Date | null;
  isAllDay: boolean;
  location: string;
  description: string;
  calendarId?: string; // Add calendar ID to preserve original calendar
}

interface DayHeader {
  element: HTMLElement;
  date: Date | null;
  hasCopyIcon: boolean;
  lastSeen: number;
}

class GoogleCalendarTools implements CalendarExtension {
  public initialized = false;
  public observer: MutationObserver | null = null;
  private readonly DEBUG = false;
  private eventCards: Map<string, EventCard> = new Map();
  private dayHeaders: Map<string, DayHeader> = new Map();
  private health: ExtensionHealth = {
    isHealthy: true,
    lastHealthCheck: Date.now(),
    errorCount: 0,
    totalEnhanced: 0,
    failedEnhancements: 0,
  };
  
  // Resilience configuration
  private readonly RESILIENCE_CONFIG = {
    maxRetries: 3,
    retryDelay: 1000, // ms
    healthCheckInterval: 2000, // OPTIMIZED: 2 seconds instead of 30 seconds
    maxErrorCount: 10,
    staleEventThreshold: 60000, // OPTIMIZED: 1 minute instead of 5 minutes
    enhancementTimeout: 2000, // OPTIMIZED: 2 seconds instead of 5 seconds
  };
  
  // Selectors based on research with fallbacks
  private readonly SELECTORS = {
    // Primary event card selector (week/day view)
    eventCard: 'div[role="button"][data-eventid]',
    // Fallback selectors for different Google Calendar versions
    eventCardFallbacks: [
      'div[role="button"].rSoRzd[data-eventid]',
      'div.rSoRzd[data-eventid]',
      '[data-eventid][role="button"]',
      '.rSoRzd[data-eventid]',
    ],
    // Month view events
    monthEvent: 'span.Tnsqdc, div.ShyPvd',
    // Event popover
    eventPopover: 'div.KzqCgd, div.Jmftzc',
    // Calendar container
    calendarContainer: '[data-eventchip], [jsname], .rSoRzd',
    // Day headers for Copy Day functionality
    dayHeader: '.yzWBv.ChfiMc.N4XV7d[role="columnheader"]', // Actual day headers in current Google Calendar
    dayHeaderFallbacks: [
      '[role="columnheader"]', // Generic column header fallback
      '.yzWBv[role="columnheader"]', // More specific but flexible
      '.hI2jVc', // The h2 element inside day headers
      '.rFrNMe', // Legacy fallback from research
    ],
  };

  constructor() {
    this.log('Initializing Google Calendar Tools with resilience features');
    this.init();
    this.startHealthMonitoring();
  }

  private log(message: string, ...args: any[]): void {
    if (this.DEBUG) {
      console.log(`[GCT]: ${message}`, ...args);
    }
  }

  private error(message: string, error?: Error): void {
    console.error(`[GCT Error]: ${message}`, error);
    this.health.errorCount++;
    
    // Auto-recovery if too many errors
    if (this.health.errorCount > this.RESILIENCE_CONFIG.maxErrorCount) {
      this.performRecovery();
    }
  }

  private async init(): Promise<void> {
    try {
      // Verify we're on Google Calendar
      if (!this.isGoogleCalendar()) {
        this.log('Not on Google Calendar, skipping initialization');
        return;
      }

      // Wait for DOM to be ready
      await this.waitForDOMReady();
      
      // Wait for Calendar to be loaded with retry logic
      await this.waitForCalendarLoadWithRetry();

      this.log('Google Calendar detected and loaded');
      this.initialized = true;
      
      // Initialize extension features
      this.setupExtension();
      
    } catch (error) {
      this.error('Failed to initialize extension', error as Error);
      // Attempt recovery after delay
      setTimeout(() => this.attemptRecovery(), this.RESILIENCE_CONFIG.retryDelay);
    }
  }

  private isGoogleCalendar(): boolean {
    return window.location.hostname === 'calendar.google.com';
  }

  private waitForDOMReady(): Promise<void> {
    return new Promise((resolve) => {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => resolve());
      } else {
        resolve();
      }
    });
  }

  private async waitForCalendarLoadWithRetry(): Promise<void> {
    let attempts = 0;
    const maxAttempts = this.RESILIENCE_CONFIG.maxRetries;
    
    while (attempts < maxAttempts) {
      try {
        await this.waitForCalendarLoad();
        return; // Success
      } catch (error) {
        attempts++;
        this.log(`Calendar load attempt ${attempts}/${maxAttempts} failed`);
        
        if (attempts >= maxAttempts) {
          throw new Error(`Failed to detect calendar after ${maxAttempts} attempts`);
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, this.RESILIENCE_CONFIG.retryDelay * attempts));
      }
    }
  }

  private waitForCalendarLoad(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Calendar load timeout'));
      }, this.RESILIENCE_CONFIG.enhancementTimeout);
      
      // Wait for key Google Calendar elements to be present
      const checkForCalendar = () => {
        const calendarContainer = this.findElementWithFallbacks([this.SELECTORS.calendarContainer]);
        if (calendarContainer) {
          clearTimeout(timeout);
          this.log('Calendar container found');
          resolve();
        } else {
          setTimeout(checkForCalendar, 100);
        }
      };
      
      checkForCalendar();
    });
  }

  private findElementWithFallbacks(selectors: string[]): HTMLElement | null {
    for (const selector of selectors) {
      const element = document.querySelector(selector) as HTMLElement;
      if (element) {
        return element;
      }
    }
    return null;
  }

  private findElementsWithFallbacks(selectors: string[]): NodeListOf<HTMLElement> | null {
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector) as NodeListOf<HTMLElement>;
      if (elements.length > 0) {
        return elements;
      }
    }
    return null;
  }

  private setupExtension(): void {
    this.log('Setting up Google Calendar Tools extension with resilience');
    
    // Inject CSS for our custom elements
    this.injectStyles();
    
    // Find and enhance existing event cards with multiple attempts
    this.scanForEventCardsWithResilience();
    
    // Scan for day headers and add Copy Day icons
    this.scanForDayHeaders();
    
    // FIXED: Additional scan attempts to ensure we catch events
    setTimeout(() => {
      this.log('Running additional scan after 200ms');
      this.fastScanForNewEvents();
    }, 200);
    
    setTimeout(() => {
      this.log('Running final scan after 1 second');
      this.fastScanForNewEvents();
      this.scanForDayHeaders(); // Re-scan day headers after calendar stabilizes
    }, 1000);
    
    // Set up MutationObserver to handle dynamic changes
    this.setupDOMObserver();
    
    this.log('Extension ready - UI injection active with resilience');
  }

  private scanForEventCardsWithResilience(): void {
    try {
      // Try primary selector first, then fallbacks
      const selectors = [this.SELECTORS.eventCard, ...this.SELECTORS.eventCardFallbacks];
      const eventCards = this.findElementsWithFallbacks(selectors);
      
      if (!eventCards) {
        this.log('No event cards found with any selector - calendar may not be loaded yet');
        return;
      }
      
      this.log(`Found ${eventCards.length} event cards to enhance`);
      
      eventCards.forEach((card) => {
        this.enhanceEventCardWithResilience(card);
      });
      
    } catch (error) {
      this.error('Error during resilient event card scanning', error as Error);
    }
  }

  private scanForDayHeaders(): void {
    try {
      this.log('Scanning for day headers to add Copy Day icons');
      
      // Try primary selector first, then fallbacks
      const selectors = [this.SELECTORS.dayHeader, ...this.SELECTORS.dayHeaderFallbacks];
      this.log(`Trying selectors: ${selectors.join(', ')}`);
      
      const dayHeaders = this.findElementsWithFallbacks(selectors);
      
      if (!dayHeaders) {
        this.log('No day headers found - may be in month view or calendar not loaded');
        return;
      }
      
      this.log(`Found ${dayHeaders.length} potential day header elements`);
      
      // Debug each found element before filtering
      Array.from(dayHeaders).forEach((header, index) => {
        const text = header.textContent?.trim() || '';
        const classes = header.className;
        const role = header.getAttribute('role');
        const hasEventId = header.hasAttribute('data-eventid');
        const rect = header.getBoundingClientRect();
        
        this.log(`Element ${index}: classes="${classes}", role="${role}", hasEventId=${hasEventId}, text="${text}", position=${rect.left},${rect.top}, size=${rect.width}x${rect.height}`);
      });
      
      // Filter out elements that are actually event cards
      const validDayHeaders = Array.from(dayHeaders).filter((header, index) => {
        const hasEventId = header.hasAttribute('data-eventid');
        const isValid = this.isValidDayHeader(header);
        this.log(`Element ${index}: hasEventId=${hasEventId}, isValid=${isValid}`);
        return !hasEventId && isValid;
      });
      
      if (validDayHeaders.length === 0) {
        this.log('No valid day headers found after filtering');
        return;
      }
      
      this.log(`Found ${validDayHeaders.length} day headers to enhance`);
      
      validDayHeaders.forEach((header) => {
        this.enhanceDayHeader(header);
      });
      
    } catch (error) {
      this.error('Error during day header scanning', error as Error);
    }
  }

  private isValidDayHeader(element: HTMLElement): boolean {
    // Check if element contains date text patterns
    const text = element.textContent?.trim() || '';
    
    // Look for date patterns - updated to handle concatenated text like "Wed9", "Mon14"
    const hasDateText = /(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\d*|\d+/i.test(text);
    
    // Check if it's positioned like a header (top area of calendar)
    const rect = element.getBoundingClientRect();
    const isInHeaderArea = rect.top < window.innerHeight / 2;
    
    // Not too small (avoid tiny elements)
    const hasReasonableSize = rect.width > 30 && rect.height > 20;
    
    // Debug why validation fails
    this.log(`Validating element: text="${text}", hasDateText=${hasDateText}, isInHeaderArea=${isInHeaderArea} (top=${rect.top}, windowHeight/2=${window.innerHeight / 2}), hasReasonableSize=${hasReasonableSize} (${rect.width}x${rect.height})`);
    
    const isValid = hasDateText && isInHeaderArea && hasReasonableSize;
    this.log(`Element validation result: ${isValid}`);
    
    return isValid;
  }

  private enhanceDayHeader(headerElement: HTMLElement): void {
    try {
      const headerId = this.generateDayHeaderId(headerElement);
      
      // Check if already enhanced
      if (this.dayHeaders.has(headerId)) {
        const existingHeader = this.dayHeaders.get(headerId)!;
        existingHeader.lastSeen = Date.now();
        
        // Check if Copy Day icon is still present
        const existingIcon = headerElement.querySelector('.gct-copy-day-btn');
        if (existingIcon) {
          this.log(`Day header ${headerId} already enhanced`);
          return;
        } else {
          this.log(`Re-injecting missing Copy Day icon for header: ${headerId}`);
        }
      }
      
      const date = this.extractDateFromDayHeader(headerElement);
      this.log(`Enhancing day header for date: ${date?.toDateString() || 'unknown'}`);
      
      // Add Copy Day icon
      this.injectCopyDayIcon(headerElement, date);
      
      // Track the enhanced header
      this.dayHeaders.set(headerId, {
        element: headerElement,
        date,
        hasCopyIcon: true,
        lastSeen: Date.now(),
      });
      
      this.log(`Enhanced day header: ${headerId}`);
      
    } catch (error) {
      this.error(`Failed to enhance day header`, error as Error);
    }
  }

  private generateDayHeaderId(headerElement: HTMLElement): string {
    // Generate a unique ID for the day header based on position and content
    const rect = headerElement.getBoundingClientRect();
    const text = headerElement.textContent?.trim() || '';
    return `header-${Math.round(rect.left)}-${Math.round(rect.top)}-${text.replace(/\s+/g, '')}`;
  }

  private extractDateFromDayHeader(headerElement: HTMLElement): Date | null {
    try {
      // First, try aria-label which contains full date info like "Monday, 14 July"
      const h2Element = headerElement.querySelector('.hI2jVc');
      if (h2Element) {
        const ariaLabel = h2Element.getAttribute('aria-label');
        if (ariaLabel) {
          this.log(`Found aria-label: "${ariaLabel}"`);
          const date = this.parseHeaderText(ariaLabel);
          if (date) {
            this.log(`Successfully parsed date from aria-label: ${date.toDateString()}`);
            return date;
          }
        }
      }
      
      // Try to extract from specific elements in current structure
      const dayNameElement = headerElement.querySelector('.sVASAd.tWjOu.RKLVef.N4XV7d');
      const dateNumberElement = headerElement.querySelector('.x5FT4e.kkUTBb');
      
      if (dayNameElement && dateNumberElement) {
        const dayName = dayNameElement.textContent?.trim() || '';
        const dateNumber = dateNumberElement.textContent?.trim() || '';
        this.log(`Found day name: "${dayName}", date number: "${dateNumber}"`);
        
        if (dateNumber.match(/^\d+$/)) {
          const dayNum = parseInt(dateNumber);
          const today = new Date();
          const date = new Date(today.getFullYear(), today.getMonth(), dayNum);
          this.log(`Successfully parsed date from day/date elements: ${date.toDateString()}`);
          return date;
        }
      }
      
      // Fallback: use the entire header text
      const text = headerElement.textContent?.trim() || '';
      this.log(`Fallback: extracting date from full header text: "${text}"`);
      const date = this.parseHeaderText(text);
      
      if (date) {
        this.log(`Successfully parsed date: ${date.toDateString()}`);
        return date;
      }
      
      this.log(`Could not parse date from header element`);
      return null;
      
    } catch (error) {
      this.error('Error extracting date from day header', error as Error);
      return null;
    }
  }

  private parseHeaderText(text: string): Date | null {
    try {
      // Format: "Mon, Jul 7" or "Monday, July 7" 
      const fullDateMatch = text.match(/(\w+),?\s+(\w+)\s+(\d+)/);
      if (fullDateMatch) {
        const [, dayName, monthStr, dayNum] = fullDateMatch;
        const currentYear = new Date().getFullYear();
        const month = this.parseMonth(monthStr);
        if (month !== -1) {
          return new Date(currentYear, month, parseInt(dayNum));
        }
      }
      
      // Format: Just day number "7"
      const dayMatch = text.match(/^\d+$/);
      if (dayMatch) {
        const dayNum = parseInt(dayMatch[0]);
        const today = new Date();
        return new Date(today.getFullYear(), today.getMonth(), dayNum);
      }
      
      // Format: Just day name "Monday" - use current week
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayName = text.toLowerCase();
      const dayIndex = dayNames.indexOf(dayName);
      if (dayIndex !== -1) {
        const today = new Date();
        const currentDay = today.getDay();
        const daysToAdd = dayIndex - currentDay;
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + daysToAdd);
        return targetDate;
      }
      
      return null;
      
    } catch (error) {
      this.error('Error parsing header text', error as Error);
      return null;
    }
  }

  private enhanceEventCardWithResilience(cardElement: HTMLElement): void {
    const startTime = Date.now();
    const eventId = cardElement.getAttribute('data-eventid') || 'unknown';
    
    try {
      this.log(`Starting enhancement for event: ${eventId}`);
      
      // Direct synchronous enhancement - no need for complex Promise handling
      this.enhanceEventCard(cardElement);
      
      // Track success
      this.health.totalEnhanced++;
      const duration = Date.now() - startTime;
      
      this.log(`✅ Enhancement completed for event: ${eventId} in ${duration}ms`);
      
      if (duration > 1000) {
        this.log(`⚠️ Slow enhancement detected: ${duration}ms for event: ${eventId}`);
      }
        
    } catch (error) {
      this.health.failedEnhancements++;
      this.error(`❌ Enhancement failed for event: ${eventId}`, error as Error);
      
      // Don't let individual failures break the entire system
      try {
        // Attempt basic tracking even if enhancement failed
        const eventId = cardElement.getAttribute('data-eventid');
        if (eventId) {
          this.eventCards.set(eventId, {
            element: cardElement,
            eventId,
            hasCustomUI: false, // Mark as not enhanced
            lastSeen: Date.now(),
          });
        }
      } catch (fallbackError) {
        this.error('Fallback tracking also failed', fallbackError as Error);
      }
    }
  }

  private enhanceEventCard(cardElement: HTMLElement): void {
    const eventId = cardElement.getAttribute('data-eventid');
    if (!eventId) {
      this.log('Event card missing data-eventid, skipping');
      return;
    }

    // Check if already enhanced AND has the button (buttons are now in document body)
    const existingButton = document.querySelector(`.gct-duplicate-btn[data-event-id="${eventId}"]`);
    if (this.eventCards.has(eventId) && existingButton) {
      // Update last seen timestamp and we're done
      const existingCard = this.eventCards.get(eventId)!;
      existingCard.lastSeen = Date.now();
      this.log(`Event ${eventId} already enhanced with button present`);
      return;
    }

    // If tracked but missing button, or not tracked at all, enhance/re-enhance
    if (this.eventCards.has(eventId) && !existingButton) {
      this.log(`Re-injecting missing button for tracked event: ${eventId}`);
    } else {
      this.log(`Enhancing new event: ${eventId}`);
    }

    try {
      // Add our custom class for styling
      cardElement.classList.add('gct-enhanced-event');
      
      // Inject duplicate button only
      this.injectDuplicateButton(cardElement, eventId);
      
      // Store the enhanced card with health metadata
      this.eventCards.set(eventId, {
        element: cardElement,
        eventId,
        hasCustomUI: true,
        lastSeen: Date.now(),
      });
      
      this.log(`Enhanced event card: ${eventId}`);
      
    } catch (error) {
      this.error(`Failed to enhance event card ${eventId}`, error as Error);
      throw error; // Re-throw for resilience handling
    }
  }

  private injectStyles(): void {
    const styleId = 'gct-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* Google Calendar Tools Custom Styles */
      .gct-duplicate-btn {
        position: absolute;
        top: 2px;
        right: 2px;
        background: rgba(255, 255, 255, 0.95);
        border: 1px solid rgba(0, 0, 0, 0.2);
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.2s ease;
        z-index: 1000;
        border-radius: 3px;
        width: 18px;
        height: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        font-size: 10px;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        pointer-events: auto;
      }
      
      .gct-duplicate-btn.show {
        opacity: 1;
      }
      
      .gct-duplicate-btn:hover {
        background: rgba(255, 255, 255, 1);
        transform: scale(1.1);
        opacity: 1 !important;
      }
      
      /* Copy Day Button Styles */
      .gct-copy-day-btn {
        position: absolute;
        top: 4px;
        right: 4px;
        background: var(--gm3-sys-color-primary-container, rgba(103, 80, 164, 0.1));
        border: 1px solid var(--gm3-sys-color-outline, rgba(0, 0, 0, 0.2));
        border-radius: 6px;
        cursor: pointer;
        opacity: 0.8;
        transition: all 0.2s ease;
        z-index: 1000;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        font-size: 12px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
        color: var(--gm3-sys-color-on-primary-container, #1a1c38);
      }
      
      .gct-copy-day-btn:hover {
        background: var(--gm3-sys-color-primary-container, rgba(103, 80, 164, 0.2));
        transform: scale(1.1);
        opacity: 1;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.16);
      }
      
      .gct-copy-day-btn:active {
        transform: scale(0.95);
      }
      
      .gct-duplicate-btn:hover {
        background: rgba(0, 0, 0, 0.1);
      }
      
      .gct-duplicate-btn .material-icons {
        font-size: 14px;
        color: var(--gm3-sys-color-on-surface, #5f6368);
      }
      
      .gct-enhanced-event:hover .gct-duplicate-btn {
        opacity: 1;
      }
      
      /* Toast notification styles */
      .gct-toast {
        transform: translateX(0);
        opacity: 1;
      }
      
      .gct-toast__icon {
        font-size: 16px;
        font-weight: bold;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        background-color: rgba(255, 255, 255, 0.2);
        flex-shrink: 0;
      }
      
      .gct-toast__message {
        flex: 1;
        line-height: 1.4;
      }
      
      .gct-toast__close {
        background: none;
        border: none;
        color: white;
        cursor: pointer;
        font-size: 18px;
        font-weight: bold;
        padding: 0;
        margin-left: 8px;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background-color 0.2s ease;
        flex-shrink: 0;
      }
      
      .gct-toast__close:hover {
        background-color: rgba(255, 255, 255, 0.2);
      }
      
      /* Toast animations */
      @keyframes gct-toast-slide-in {
        0% {
          transform: translateX(100%);
          opacity: 0;
        }
        100% {
          transform: translateX(0);
          opacity: 1;
        }
      }
      
      @keyframes gct-toast-slide-out {
        0% {
          transform: translateX(0);
          opacity: 1;
        }
        100% {
          transform: translateX(100%);
          opacity: 0;
        }
      }
      
      /* Toast type-specific styles */
      .gct-toast--success .gct-toast__icon {
        background-color: #4caf50;
      }
      
      .gct-toast--error .gct-toast__icon {
        background-color: #f44336;
      }
      
      .gct-toast--info .gct-toast__icon {
        background-color: #2196f3;
      }

      /* Modal Styles */
      .gct-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        animation: gct-modal-fade-in 0.2s ease-out;
      }

      .gct-modal {
        background: white;
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
        max-width: 420px;
        width: 90%;
        max-height: 90vh;
        overflow: hidden;
        animation: gct-modal-slide-in 0.3s ease-out;
        font-family: var(--gm3-sys-typescale-body-medium-font, 'Google Sans', Roboto, sans-serif);
      }

      .gct-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px 24px 16px;
        border-bottom: 1px solid var(--gm3-sys-color-outline-variant, #e8eaed);
      }

      .gct-modal-title {
        margin: 0;
        font-size: 20px;
        font-weight: 500;
        color: var(--gm3-sys-color-on-surface, #202124);
        line-height: 1.2;
      }

      .gct-modal-close {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        padding: 4px;
        margin: -4px;
        border-radius: 50%;
        color: var(--gm3-sys-color-on-surface-variant, #5f6368);
        transition: background-color 0.2s ease;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .gct-modal-close:hover {
        background-color: var(--gm3-sys-color-secondary-container, rgba(103, 80, 164, 0.08));
      }

      .gct-modal-body {
        padding: 20px 24px;
      }

      .gct-modal-description {
        margin: 0 0 20px 0;
        font-size: 14px;
        line-height: 1.5;
        color: var(--gm3-sys-color-on-surface, #202124);
      }

      .gct-modal-form {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .gct-form-label {
        font-size: 14px;
        font-weight: 500;
        color: var(--gm3-sys-color-on-surface, #202124);
        margin-bottom: 4px;
      }

      .gct-form-input {
        padding: 12px 16px;
        border: 1px solid var(--gm3-sys-color-outline, #dadce0);
        border-radius: 4px;
        font-size: 14px;
        font-family: inherit;
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
        background: white;
        color: var(--gm3-sys-color-on-surface, #202124);
      }

      .gct-form-input:focus {
        outline: none;
        border-color: var(--gm3-sys-color-primary, #1a73e8);
        box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.2);
      }

      .gct-error-message {
        font-size: 12px;
        color: var(--gm3-sys-color-error, #d93025);
        min-height: 16px;
        margin-top: 4px;
      }

      .gct-modal-footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 16px 24px 20px;
        border-top: 1px solid var(--gm3-sys-color-outline-variant, #e8eaed);
      }

      .gct-btn {
        padding: 10px 20px;
        border-radius: 4px;
        font-size: 14px;
        font-weight: 500;
        font-family: inherit;
        cursor: pointer;
        transition: all 0.2s ease;
        border: none;
        min-width: 80px;
        text-align: center;
      }

      .gct-btn-primary {
        background: var(--gm3-sys-color-primary, #1a73e8);
        color: var(--gm3-sys-color-on-primary, white);
      }

      .gct-btn-primary:hover {
        background: var(--gm3-sys-color-primary-hover, #1557b0);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
      }

      .gct-btn-secondary {
        background: transparent;
        color: var(--gm3-sys-color-primary, #1a73e8);
        border: 1px solid var(--gm3-sys-color-outline, #dadce0);
      }

      .gct-btn-secondary:hover {
        background: var(--gm3-sys-color-primary-container, rgba(26, 115, 232, 0.04));
        border-color: var(--gm3-sys-color-primary, #1a73e8);
      }

      /* Modal Animations */
      @keyframes gct-modal-fade-in {
        0% {
          opacity: 0;
        }
        100% {
          opacity: 1;
        }
      }

      @keyframes gct-modal-slide-in {
        0% {
          transform: translateY(-50px);
          opacity: 0;
        }
        100% {
          transform: translateY(0);
          opacity: 1;
        }
      }

      /* Conflict Resolution Modal Styles */
      .gct-conflict-modal {
        max-width: 700px;
        width: 95%;
        max-height: 80vh;
      }

      .gct-conflict-body {
        max-height: 60vh;
        overflow-y: auto;
        padding: 20px;
      }

      .gct-conflict-description {
        margin-bottom: 20px;
        color: #5f6368;
        line-height: 1.5;
      }

      .gct-conflicts-list {
        display: flex;
        flex-direction: column;
        gap: 20px;
        margin-bottom: 24px;
      }

      .gct-conflict {
        border: 1px solid #e8eaed;
        border-radius: 8px;
        padding: 16px;
        background: #fff;
      }

      .gct-conflict-event {
        margin-bottom: 16px;
        padding-bottom: 16px;
        border-bottom: 1px solid #f1f3f4;
      }

      .gct-conflict-title {
        margin: 0 0 8px 0;
        font-size: 16px;
        font-weight: 500;
        color: #202124;
      }

      .gct-conflict-time {
        margin: 0 0 12px 0;
        color: #5f6368;
        font-size: 14px;
      }

      .gct-conflict-label {
        margin: 0 0 8px 0;
        font-size: 14px;
        font-weight: 500;
        color: #202124;
      }

      .gct-conflicts-existing {
        margin: 0;
        padding-left: 20px;
        color: #ea4335;
      }

      .gct-conflict-item {
        margin-bottom: 4px;
        font-size: 14px;
      }

      .gct-radio-group {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 12px;
      }

      .gct-radio-option {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        padding: 8px;
        border-radius: 4px;
        transition: background-color 0.2s ease;
      }

      .gct-radio-option:hover {
        background-color: #f8f9fa;
      }

      .gct-radio-option input[type="radio"] {
        margin: 0;
        accent-color: #1a73e8;
      }

      .gct-radio-label {
        font-size: 14px;
        color: #202124;
        line-height: 1.4;
      }

      .gct-resolution-preview {
        padding: 8px 12px;
        border-radius: 4px;
        font-size: 13px;
        font-weight: 500;
        text-align: center;
      }

      .gct-preview-skip {
        color: #5f6368;
        background-color: #f1f3f4;
      }

      .gct-preview-overwrite {
        color: #ea4335;
        background-color: #fce8e6;
      }

      .gct-preview-copy {
        color: #137333;
        background-color: #e6f4ea;
      }

      .gct-bulk-actions {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px;
        background-color: #f8f9fa;
        border-radius: 8px;
        margin-top: 20px;
      }

      .gct-bulk-label {
        font-size: 14px;
        font-weight: 500;
        color: #202124;
        margin: 0;
      }

      .gct-bulk-btn {
        background: white;
        border: 1px solid #dadce0;
        border-radius: 4px;
        padding: 8px 16px;
        font-size: 13px;
        color: #1a73e8;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .gct-bulk-btn:hover {
        background: #f8f9fa;
        border-color: #1a73e8;
      }

      .gct-bulk-btn:active {
        background: #e8f0fe;
      }

      /* Copy Results Modal Styles */
      .gct-copy-results-modal {
        max-width: 600px;
        width: 90%;
        max-height: 80vh;
      }

      .gct-copy-results-body {
        padding: 20px;
        max-height: 60vh;
        overflow-y: auto;
      }

      .gct-copy-summary {
        margin-bottom: 24px;
        text-align: center;
      }

      .gct-copy-date-info {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        margin-bottom: 16px;
        font-size: 16px;
        font-weight: 500;
        color: #3c4043;
      }

      .gct-copy-from, .gct-copy-to {
        padding: 6px 12px;
        background: #f8f9fa;
        border-radius: 4px;
        border: 1px solid #dadce0;
      }

      .gct-copy-arrow {
        font-size: 18px;
        color: #5f6368;
        font-weight: bold;
      }

      .gct-copy-stats {
        display: flex;
        justify-content: center;
        gap: 16px;
        flex-wrap: wrap;
      }

      .gct-stat-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 12px 16px;
        border-radius: 8px;
        min-width: 80px;
      }

      .gct-stat-success {
        background: #e8f5e8;
        border: 1px solid #81c784;
      }

      .gct-stat-error {
        background: #ffeaea;
        border: 1px solid #f28b82;
      }

      .gct-stat-warning {
        background: #fff8e1;
        border: 1px solid #ffb74d;
      }

      .gct-stat-info {
        background: #e3f2fd;
        border: 1px solid #64b5f6;
      }

      .gct-stat-number {
        font-size: 24px;
        font-weight: 600;
        line-height: 1;
        margin-bottom: 4px;
      }

      .gct-stat-success .gct-stat-number {
        color: #2e7d32;
      }

      .gct-stat-error .gct-stat-number {
        color: #c62828;
      }

      .gct-stat-warning .gct-stat-number {
        color: #ef6c00;
      }

      .gct-stat-info .gct-stat-number {
        color: #1565c0;
      }

      .gct-stat-label {
        font-size: 12px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #5f6368;
      }

      .gct-result-section {
        margin-bottom: 20px;
      }

      .gct-result-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 16px;
        font-weight: 500;
        margin-bottom: 12px;
        padding-bottom: 8px;
        border-bottom: 1px solid #dadce0;
      }

      .gct-result-title-success {
        color: #2e7d32;
      }

      .gct-result-title-error {
        color: #c62828;
      }

      .gct-result-icon {
        font-size: 18px;
        font-weight: bold;
      }

      .gct-result-list {
        max-height: 200px;
        overflow-y: auto;
      }

      .gct-result-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        margin-bottom: 4px;
        border-radius: 4px;
        border-left: 3px solid;
      }

      .gct-result-item-success {
        background: #f1f8e9;
        border-left-color: #4caf50;
      }

      .gct-result-item-error {
        background: #ffebee;
        border-left-color: #f44336;
        flex-direction: column;
        align-items: flex-start;
      }

      .gct-event-title {
        font-weight: 500;
        color: #3c4043;
        flex: 1;
      }

      .gct-event-time {
        font-size: 13px;
        color: #5f6368;
        white-space: nowrap;
        margin-left: 8px;
      }

      .gct-event-error {
        font-size: 12px;
        color: #d32f2f;
        margin-top: 4px;
        font-style: italic;
      }

      .gct-no-events {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 24px;
        text-align: center;
        color: #5f6368;
        font-style: italic;
      }

      .gct-no-events .gct-result-icon {
        font-size: 20px;
        color: #9aa0a6;
      }
    `;
    
    document.head.appendChild(style);
    this.log('Custom styles injected');
  }



  private injectDuplicateButton(cardElement: HTMLElement, eventId: string): void {
    // Check if button already exists (buttons are now in document body)
    const existingButton = document.querySelector(`.gct-duplicate-btn[data-event-id="${eventId}"]`);
    if (existingButton) {
      this.log(`Button already exists for event: ${eventId}`);
      return;
    }

    try {
      this.log(`Injecting duplicate button for event: ${eventId}`);
      
      const button = document.createElement('button');
      button.className = 'gct-duplicate-btn';
      button.setAttribute('data-event-id', eventId);
      button.title = 'Duplicate event to tomorrow';
      button.innerHTML = '📋';

      // Simply append to the event card - much more reliable
      cardElement.appendChild(button);
      
      // Simplified, more reliable hover logic with click debouncing
      let hideTimeout: NodeJS.Timeout | null = null;
      let isClicking = false;
      let lastClickTime = 0;
      const CLICK_DEBOUNCE_MS = 500;
      
      const showButton = () => {
        if (hideTimeout) {
          clearTimeout(hideTimeout);
          hideTimeout = null;
        }
        button.classList.add('show');
      };
      
      const hideButton = () => {
        // Don't hide if currently clicking
        if (isClicking) return;
        
        // Longer delay to prevent interference with clicking
        hideTimeout = setTimeout(() => {
          if (!isClicking) {
            button.classList.remove('show');
          }
        }, 300);
      };
      
      // Event card hover
      cardElement.addEventListener('mouseenter', showButton);
      cardElement.addEventListener('mouseleave', hideButton);
      
      // Button hover - keep visible when hovering button itself
      button.addEventListener('mouseenter', () => {
        showButton();
        isClicking = false; // Reset click state on hover
      });
      button.addEventListener('mouseleave', hideButton);

      // More robust click handling
      button.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        isClicking = true;
        
        this.log(`Mousedown on button for event: ${eventId}`);
        
        // Clear any hide timeout
        if (hideTimeout) {
          clearTimeout(hideTimeout);
          hideTimeout = null;
        }
        
        // Ensure button stays visible and provide visual feedback
        button.classList.add('show');
        button.style.transform = 'scale(0.95)';
      });
      
      button.addEventListener('mouseup', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        this.log(`Mouseup on button for event: ${eventId}`);
        
        // Reset visual feedback
        button.style.transform = 'scale(1.1)';
      });
      
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        const currentTime = Date.now();
        this.log(`Click event received for event: ${eventId}, isClicking: ${isClicking}, timeSinceLastClick: ${currentTime - lastClickTime}ms`);
        
        // Debounce rapid clicks
        if (currentTime - lastClickTime < CLICK_DEBOUNCE_MS) {
          this.log(`❌ Click ignored - too soon after last click (${currentTime - lastClickTime}ms < ${CLICK_DEBOUNCE_MS}ms)`);
          return;
        }
        
        // Only process if we're in a clicking state
        if (!isClicking) {
          this.log(`❌ Click ignored - not in clicking state for event: ${eventId}`);
          return;
        }
        
        lastClickTime = currentTime;
        this.log(`✅ Processing valid click for event: ${eventId}`);
        
        // Provide immediate visual feedback
        button.style.background = 'rgba(76, 175, 80, 0.9)';
        button.innerHTML = '⏳';
        
        // Reset clicking state after a delay to prevent double-clicks
        setTimeout(() => {
          isClicking = false;
          this.log(`Reset isClicking state for event: ${eventId}`);
        }, 2000); // Increased to 2 seconds to give duplication time to complete
        
        // Execute duplication
        this.handleEventDuplicate(eventId).finally(() => {
          // Reset button appearance after duplication (success or failure)
          setTimeout(() => {
            if (button.parentElement) {
              button.style.background = '';
              button.innerHTML = '📋';
              button.style.transform = '';
            }
          }, 1000); // Reduced to 1 second since duplication is already complete
        });
      });

      // Store button reference and state for cleanup
      button.setAttribute('data-event-id', eventId);
      (button as any)._hideTimeout = hideTimeout;
      (button as any)._isClicking = isClicking;
      (button as any)._lastClickTime = lastClickTime;
      
      this.log(`✅ Button successfully injected for event: ${eventId}`);
      
    } catch (error) {
      this.error(`Failed to inject button for event ${eventId}`, error as Error);
      throw error;
    }
  }

  private injectCopyDayIcon(headerElement: HTMLElement, date: Date | null): void {
    try {
      this.log(`Injecting Copy Day icon for date: ${date?.toDateString() || 'unknown'}`);
      
      // Find the h2 element within the header for more specific positioning
      const h2Element = headerElement.querySelector('.hI2jVc') as HTMLElement;
      const targetElement = h2Element || headerElement;
      
      // Make target element relatively positioned to contain the absolute icon
      if (getComputedStyle(targetElement).position === 'static') {
        targetElement.style.position = 'relative';
      }
      
      const button = document.createElement('button');
      button.className = 'gct-copy-day-btn';
      button.title = `Copy all events from ${date?.toDateString() || 'this day'}`;
      button.innerHTML = '📋'; // Copy icon
      
      // Store the date for later use
      if (date) {
        button.setAttribute('data-source-date', date.toISOString());
      }
      
      targetElement.appendChild(button);
      
      // Click handler for Copy Day functionality
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        this.log(`Copy Day clicked for date: ${date?.toDateString()}`);
        
        if (date) {
          this.handleCopyDay(date);
        } else {
          this.showNotification('Unable to determine date for this day', 'error');
        }
      });
      
      this.log(`✅ Copy Day icon successfully injected for date: ${date?.toDateString()}`);
      
    } catch (error) {
      this.error(`Failed to inject Copy Day icon`, error as Error);
      throw error;
    }
  }

  private async handleCopyDay(sourceDate: Date): Promise<void> {
    try {
      console.log(`🚀 Starting Copy Day workflow for: ${sourceDate.toDateString()}`);
      
      // Step 1: Show target date selection modal
      const targetDate = await this.showTargetDaySelectionModal(sourceDate);
      if (!targetDate) {
        console.log('Copy Day workflow cancelled - no target date selected');
        return;
      }

      console.log(`Target date selected: ${targetDate.toDateString()}`);

      // Try API-based approach first, fallback to DOM scraping
      let sourceEvents: EventDetails[];
      let targetEvents: EventDetails[];
      let useAPIApproach = false;

      try {
        // Test API availability by trying to get auth token
        console.log('🔐 Testing API authentication...');
        await this.sendMessageToBackground({ type: 'AUTH_TOKEN', interactive: false });
        useAPIApproach = true;
        console.log('✅ API available - using fast API-based approach');
        
        // Use fast API collection
        sourceEvents = await this.collectEventsFromDayAPI(sourceDate);
        targetEvents = await this.collectEventsFromDayAPI(targetDate);
        
      } catch (apiError) {
        console.log('⚠️ API unavailable - falling back to DOM scraping approach');
        console.error('API fallback triggered:', apiError);
        
        // If it's a timeout or auth error, try interactive auth once
        const errorMessage = (apiError as Error).message || String(apiError);
        if (errorMessage.includes('timeout') || errorMessage.includes('auth')) {
          console.log('🔐 Attempting interactive authentication...');
          this.showNotification('First-time setup: Please grant calendar permissions', 'info');
          
          try {
            await this.sendMessageToBackground({ type: 'AUTH_TOKEN', interactive: true });
            console.log('✅ Interactive auth successful - retrying API approach');
            
            // Retry with API approach
            sourceEvents = await this.collectEventsFromDayAPI(sourceDate);
            targetEvents = await this.collectEventsFromDayAPI(targetDate);
            useAPIApproach = true;
            
          } catch (interactiveError) {
            console.error('❌ Interactive auth also failed:', interactiveError);
            // Fall back to DOM scraping
            this.showNotification(
              'Using slower fallback method. Check OAuth2 setup in Google Cloud Console',
              'info'
            );
            sourceEvents = await this.collectEventsFromDay(sourceDate);
            targetEvents = await this.collectEventsFromDay(targetDate);
          }
        } else {
          // Show user a notification about the fallback
          this.showNotification(
            'Using slower fallback method. For fastest performance, complete OAuth2 setup in Google Cloud Console',
            'info'
          );
          
          // Fallback to DOM scraping
          sourceEvents = await this.collectEventsFromDay(sourceDate);
          targetEvents = await this.collectEventsFromDay(targetDate);
        }
      }

      this.log(`Collected ${sourceEvents.length} events from ${sourceDate.toDateString()}`);
      
      if (sourceEvents.length === 0) {
        this.showNotification(
          `No events found on ${sourceDate.toDateString()} to copy`,
          'info'
        );
        return;
      }
      
      // Step 2: Handle overlaps and conflicts
      const conflicts = this.detectEventConflicts(sourceEvents, targetEvents, targetDate);
      this.log(`Found ${conflicts.length} potential conflicts on target day`);
      
      let eventsToProcess = sourceEvents;
      if (conflicts.length > 0) {
        const resolutionResults = await this.showConflictResolutionModal(conflicts, sourceDate, targetDate);
        if (resolutionResults === null) {
          this.log('Copy Day workflow cancelled due to conflicts');
          return;
        }
        eventsToProcess = resolutionResults;
      }
      
      // Step 3: Copy events to target date using appropriate method
      if (eventsToProcess.length > 0) {
        let copyResults;
        if (useAPIApproach) {
          this.log('🚀 Using fast API-based bulk copying');
          copyResults = await this.copyEventsToTargetDayAPI(eventsToProcess, targetDate, conflicts);
        } else {
          this.log('⚠️ Using DOM-based copying (slower)');
          copyResults = await this.copyEventsToTargetDay(eventsToProcess, targetDate, conflicts);
        }
        
        // Step 4: Show results
        await this.showCopyResultsModal(copyResults, sourceDate, targetDate, eventsToProcess, conflicts);
      } else {
        this.showNotification(
          'No events selected for copying after conflict resolution.',
          'info'
        );
      }
      
    } catch (error) {
      this.error('Error in Copy Day workflow', error as Error);
      this.showNotification('Error occurred while copying day', 'error');
    }
  }

  private async collectEventsFromDay(sourceDate: Date): Promise<EventDetails[]> {
    try {
      this.log(`Starting event collection for ${sourceDate.toDateString()}`);
      const collectedEvents: EventDetails[] = [];
      
      // Find all event cards that match the source date
      const candidateEvents = this.findEventsForDate(sourceDate);
      this.log(`Found ${candidateEvents.length} candidate event(s) for date`);
      
      if (candidateEvents.length === 0) {
        this.log('No events found for the specified date');
        return collectedEvents;
      }
      
      // Process each candidate event
      for (const eventInfo of candidateEvents) {
        try {
          this.log(`Processing event: ${eventInfo.eventId}`);
          
          // Open the event popover to extract details
          await this.openEventDetailPopover(eventInfo.element);
          
          // Small delay to ensure popover is fully loaded
          await new Promise(resolve => setTimeout(resolve, 300));
          
          // Extract the event details
          const eventDetails = await this.extractEventDetails(eventInfo.eventId);
          
          // Validate that this event actually occurs on our target date
          if (this.eventOccursOnDate(eventDetails, sourceDate)) {
            collectedEvents.push(eventDetails);
            this.log(`Successfully collected event: ${eventDetails.title}`);
          } else {
            this.log(`Event "${eventDetails.title}" does not occur on target date, skipping`);
          }
          
          // Close the popover before processing next event
          await this.closeEventPopover();
          
          // Small delay between events to avoid overwhelming the UI
          await new Promise(resolve => setTimeout(resolve, 200));
          
        } catch (error) {
          this.error(`Failed to process event ${eventInfo.eventId}`, error as Error);
          // Continue with next event even if one fails
          await this.closeEventPopover(); // Ensure popover is closed
        }
      }
      
      this.log(`Event collection completed. Collected ${collectedEvents.length} valid events`);
      return collectedEvents;
      
    } catch (error) {
      this.error('Error during event collection', error as Error);
      throw error;
    }
  }

  // ===== API-BASED METHODS FOR FAST BULK OPERATIONS =====

  /**
   * Send message to background script and await response
   */
  private async sendMessageToBackground(message: any): Promise<any> {
    return new Promise((resolve, reject) => {
      console.log('📤 Sending message to background:', message.type);
      
      // Add timeout to prevent hanging
      const timeout = setTimeout(() => {
        console.error('⏱️ Background message timeout after 10 seconds');
        reject(new Error('Background script timeout'));
      }, 10000);
      
      chrome.runtime.sendMessage(message, (response) => {
        clearTimeout(timeout);
        console.log('📥 Received response from background:', response);
        
        if (chrome.runtime.lastError) {
          console.error('❌ Chrome runtime error:', chrome.runtime.lastError.message);
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response?.success) {
          console.log('✅ Background response success');
          resolve(response.data);
        } else {
          console.error('❌ Background response error:', response?.error);
          reject(new Error(response?.error || 'Unknown API error'));
        }
      });
    });
  }

  /**
   * Fast API-based event collection for a specific date
   */
  private async collectEventsFromDayAPI(sourceDate: Date): Promise<EventDetails[]> {
    try {
      this.log(`🚀 Starting fast API-based event collection for ${sourceDate.toDateString()}`);
      
      // Calculate date range for the specific day (start and end of day)
      const startOfDay = new Date(sourceDate);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(sourceDate);
      endOfDay.setHours(23, 59, 59, 999);
      
      const timeMin = startOfDay.toISOString();
      const timeMax = endOfDay.toISOString();

      // Get calendars to collect events from all user calendars
      const calendars = await this.sendMessageToBackground({
        type: 'GET_CALENDARS'
      });

      this.log(`Found ${calendars.length} calendars to search`);

      // Collect events from all calendars for the specific date
      const allEvents: EventDetails[] = [];
      
      for (const calendar of calendars) {
        try {
          const calendarEvents = await this.sendMessageToBackground({
            type: 'GET_EVENTS',
            calendarId: calendar.id,
            timeMin,
            timeMax
          });

          // Convert API response to EventDetails format
          for (const apiEvent of calendarEvents) {
            const eventDetails: EventDetails = {
              id: apiEvent.id || `api-${Math.random().toString(36).substr(2, 9)}`,
              title: apiEvent.summary || 'Untitled Event',
              startDateTime: this.parseAPIDateTime(apiEvent.start),
              endDateTime: this.parseAPIDateTime(apiEvent.end),
              isAllDay: !!(apiEvent.start?.date), // All-day events use 'date' instead of 'dateTime'
              location: apiEvent.location || '',
              description: apiEvent.description || '',
              calendarId: calendar.id
            };

            // Verify this event actually occurs on our target date
            if (this.eventOccursOnDate(eventDetails, sourceDate)) {
              allEvents.push(eventDetails);
              this.log(`✅ API collected event: ${eventDetails.title} from calendar: ${calendar.summary || calendar.id}`);
            }
          }
        } catch (calendarError) {
          this.error(`Failed to get events from calendar ${calendar.id}`, calendarError as Error);
          // Continue with other calendars
        }
      }

      this.log(`🎯 API collection completed. Found ${allEvents.length} events for ${sourceDate.toDateString()}`);
      return allEvents;

    } catch (error) {
      this.error('API-based event collection failed', error as Error);
      throw error;
    }
  }

  /**
   * Parse API date/time objects to Date
   */
  private parseAPIDateTime(dateTimeObj: any): Date | null {
    if (!dateTimeObj) return null;
    
    // Handle all-day events (date field)
    if (dateTimeObj.date) {
      return new Date(dateTimeObj.date);
    }
    
    // Handle timed events (dateTime field)
    if (dateTimeObj.dateTime) {
      return new Date(dateTimeObj.dateTime);
    }
    
    return null;
  }

  /**
   * Fast API-based bulk event copying
   */
  private async copyEventsToTargetDayAPI(
    eventsToProcess: EventDetails[], 
    targetDate: Date, 
    conflicts: Array<{sourceEvent: EventDetails, conflictingEvents: EventDetails[]}>
  ): Promise<{successful: EventDetails[], failed: Array<{event: EventDetails, error: string}>}> {
    
    const results = {
      successful: [] as EventDetails[],
      failed: [] as Array<{event: EventDetails, error: string}>
    };

    try {
      this.log(`🚀 Starting fast API-based bulk copy of ${eventsToProcess.length} events to ${targetDate.toDateString()}`);

      // Show progress notification
      this.showNotification(
        `Fast copying ${eventsToProcess.length} event(s) to ${targetDate.toDateString()}...`,
        'info'
      );

      // Handle overwrite conflicts by deleting existing events first
      const eventsToDelete: EventDetails[] = [];
      for (const eventToProcess of eventsToProcess) {
        const eventConflict = conflicts.find(c => c.sourceEvent.id === eventToProcess.id);
        if (eventConflict && eventConflict.conflictingEvents.length > 0) {
          eventsToDelete.push(...eventConflict.conflictingEvents);
        }
      }

      // Delete conflicting events if any (TODO: implement API-based deletion)
      if (eventsToDelete.length > 0) {
        this.log(`⚠️ Would delete ${eventsToDelete.length} conflicting events (API deletion not implemented yet)`);
        // For now, log the deletion - this will be implemented in future iterations
      }

      // Prepare events for bulk creation
      const eventsToCreate = eventsToProcess.map(event => {
        const adjustedEvent = this.adjustEventForNewDate(event, targetDate);
        const calendarId = event.calendarId || 'primary';
        this.log(`🗓️ Preparing event "${event.title}" for calendar: ${calendarId}`);
        return {
          event: this.convertToAPIEventFormat(adjustedEvent),
          calendarId: calendarId
        };
      });

      // Use bulk API to create all events - group by calendar first since Google API 
      // doesn't allow operations on different calendars in the same batch request
      if (eventsToCreate.length > 0) {
        const BATCH_SIZE = 1000; // Google Calendar API batch limit
        
        // Group events by calendar ID first
        const eventsByCalendar = new Map<string, Array<{event: any, calendarId: string, originalIndex: number}>>();
        
        eventsToCreate.forEach((eventToCreate, index) => {
          const calendarId = eventToCreate.calendarId;
          if (!eventsByCalendar.has(calendarId)) {
            eventsByCalendar.set(calendarId, []);
          }
          eventsByCalendar.get(calendarId)!.push({
            ...eventToCreate,
            originalIndex: index
          });
        });
        
        this.log(`🗓️ Events grouped into ${eventsByCalendar.size} calendar(s): ${Array.from(eventsByCalendar.keys()).join(', ')}`);
        
        // Process each calendar separately
        for (const [calendarId, calendarEvents] of eventsByCalendar) {
          this.log(`📅 Processing ${calendarEvents.length} events for calendar: ${calendarId}`);
          
          // Split calendar events into batches if needed
          const calendarBatches: Array<Array<{event: any, calendarId: string, originalIndex: number}>> = [];
          for (let i = 0; i < calendarEvents.length; i += BATCH_SIZE) {
            calendarBatches.push(calendarEvents.slice(i, i + BATCH_SIZE));
          }
          
          // Process each batch for this calendar
          for (let batchIndex = 0; batchIndex < calendarBatches.length; batchIndex++) {
            const batch = calendarBatches[batchIndex];
            
            try {
              this.log(`🔄 Processing calendar "${calendarId}" batch ${batchIndex + 1}/${calendarBatches.length} with ${batch.length} events`);
              
              const createResults = await this.sendMessageToBackground({
                type: 'BULK_CREATE_EVENTS',
                events: batch
              });

              // Process results for this batch
              for (let i = 0; i < batch.length; i++) {
                const batchEvent = batch[i];
                const originalEvent = eventsToProcess[batchEvent.originalIndex];
                const createResult = createResults.data?.[i] || createResults[i]; // Handle both response formats
                
                if (createResult && !createResult.error) {
                  results.successful.push(originalEvent);
                  this.log(`✅ Successfully copied to ${calendarId}: ${originalEvent.title}`);
                } else {
                  const errorMessage = createResult?.error?.message || createResult?.error || 'Unknown API error';
                  results.failed.push({ event: originalEvent, error: errorMessage });
                  this.error(`❌ Failed to copy to ${calendarId}: ${originalEvent.title}`, new Error(errorMessage));
                }
              }
              
              // Small delay between batches to be respectful to the API
              if (batchIndex < calendarBatches.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
              }
              
            } catch (batchError) {
              // If this batch fails, add all events in the batch to failed
              for (const batchEvent of batch) {
                const originalEvent = eventsToProcess[batchEvent.originalIndex];
                results.failed.push({ 
                  event: originalEvent, 
                  error: `Calendar ${calendarId} batch ${batchIndex + 1} failed: ${(batchError as Error).message}` 
                });
              }
              this.error(`❌ Calendar ${calendarId} batch ${batchIndex + 1} failed`, batchError as Error);
            }
          }
          
          // Small delay between calendars
          const calendarKeys = Array.from(eventsByCalendar.keys());
          const currentCalendarIndex = calendarKeys.indexOf(calendarId);
          if (currentCalendarIndex < calendarKeys.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
      }

      this.log(`🎯 Fast API copy completed. Success: ${results.successful.length}, Failed: ${results.failed.length}`);
      
      // Show success notification
      if (results.successful.length > 0) {
        this.showNotification(
          `Successfully copied ${results.successful.length} event(s) in seconds!`,
          'success'
        );
      }

      return results;

    } catch (error) {
      this.error('API-based bulk copy failed', error as Error);
      // Add all events to failed
      for (const event of eventsToProcess) {
        results.failed.push({ 
          event, 
          error: `API operation failed: ${(error as Error).message}` 
        });
      }
      return results;
    }
  }

  /**
   * Convert EventDetails to Google Calendar API event format
   */
  private convertToAPIEventFormat(eventDetails: EventDetails): any {
    const apiEvent: any = {
      summary: eventDetails.title,
      description: eventDetails.description,
      location: eventDetails.location
    };

    // Handle start and end times
    if (eventDetails.isAllDay) {
      if (eventDetails.startDateTime) {
        const startDate = new Date(eventDetails.startDateTime);
        apiEvent.start = { date: this.formatDateOnly(startDate) };
        
        if (eventDetails.endDateTime) {
          const endDate = new Date(eventDetails.endDateTime);
          apiEvent.end = { date: this.formatDateOnly(endDate) };
        } else {
          // For single-day all-day events, end date is the next day
          const endDate = new Date(startDate);
          endDate.setDate(endDate.getDate() + 1);
          apiEvent.end = { date: this.formatDateOnly(endDate) };
        }
      }
    } else {
      // Timed events
      if (eventDetails.startDateTime) {
        apiEvent.start = { 
          dateTime: eventDetails.startDateTime.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        };
      }
      
      if (eventDetails.endDateTime) {
        apiEvent.end = { 
          dateTime: eventDetails.endDateTime.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        };
      }
    }

    return apiEvent;
  }

  private findEventsForDate(targetDate: Date): Array<{element: HTMLElement, eventId: string}> {
    const candidateEvents: Array<{element: HTMLElement, eventId: string}> = [];
    
    this.log(`Finding events for target date: ${targetDate.toDateString()}`);
    
    // Check all known event cards
    for (const [eventId, eventCard] of this.eventCards) {
      // Verify the element still exists in DOM
      if (!document.contains(eventCard.element)) {
        this.eventCards.delete(eventId);
        continue;
      }
      
      // Try to determine if this event occurs on our target date
      const eventDate = this.extractEventDateFromCalendarPosition(eventCard.element);
      
      if (eventDate && this.isSameDay(eventDate, targetDate)) {
        candidateEvents.push({
          element: eventCard.element,
          eventId: eventId
        });
        this.log(`✅ Event ${eventId} matches target date based on position: ${eventDate.toDateString()}`);
      } else if (eventDate) {
        this.log(`❌ Event ${eventId} is on different date: ${eventDate.toDateString()}, skipping`);
      } else {
        this.log(`⚠️ Could not extract date for event ${eventId}, skipping for safety`);
      }
    }
    
    // Also scan for any new events that might not be in our cache
    this.scanForEventCardsWithResilience();
    
    // Check newly discovered events
    for (const [eventId, eventCard] of this.eventCards) {
      const isAlreadyIncluded = candidateEvents.some(candidate => candidate.eventId === eventId);
      if (!isAlreadyIncluded && document.contains(eventCard.element)) {
        const eventDate = this.extractEventDateFromCalendarPosition(eventCard.element);
        if (eventDate && this.isSameDay(eventDate, targetDate)) {
          candidateEvents.push({
            element: eventCard.element,
            eventId: eventId
          });
          this.log(`✅ Newly discovered event ${eventId} matches target date: ${eventDate.toDateString()}`);
        } else if (eventDate) {
          this.log(`❌ Newly discovered event ${eventId} is on different date: ${eventDate.toDateString()}, skipping`);
        } else {
          this.log(`⚠️ Could not extract date for newly discovered event ${eventId}, skipping`);
        }
      }
    }
    
    this.log(`Final candidates for ${targetDate.toDateString()}: ${candidateEvents.length} events`);
    return candidateEvents;
  }

  private eventOccursOnDate(eventDetails: EventDetails, targetDate: Date): boolean {
    // For all-day events
    if (eventDetails.isAllDay) {
      if (eventDetails.startDateTime && eventDetails.endDateTime) {
        const startDate = new Date(eventDetails.startDateTime);
        const endDate = new Date(eventDetails.endDateTime);
        
        // Check if target date falls within the all-day event range
        const targetTime = targetDate.getTime();
        const startTime = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime();
        const endTime = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime();
        
        return targetTime >= startTime && targetTime <= endTime;
      }
    }
    
    // For timed events
    if (eventDetails.startDateTime) {
      const eventDate = new Date(eventDetails.startDateTime);
      if (this.isSameDay(eventDate, targetDate)) {
        return true;
      }
    }
    
    // For multi-day events, check if target date falls within the range
    if (eventDetails.startDateTime && eventDetails.endDateTime) {
      const startDate = new Date(eventDetails.startDateTime);
      const endDate = new Date(eventDetails.endDateTime);
      
      return targetDate >= startDate && targetDate <= endDate;
    }
    
    return false;
  }

  private detectEventConflicts(sourceEvents: EventDetails[], targetEvents: EventDetails[], targetDate: Date): Array<{sourceEvent: EventDetails, conflictingEvents: EventDetails[]}> {
    const conflicts: Array<{sourceEvent: EventDetails, conflictingEvents: EventDetails[]}> = [];
    
    for (const sourceEvent of sourceEvents) {
      const conflictingEvents: EventDetails[] = [];
      
      // Adjust source event times to target date
      const adjustedSourceEvent = this.adjustEventForNewDate(sourceEvent, targetDate);
      
      for (const targetEvent of targetEvents) {
        if (this.eventsOverlap(adjustedSourceEvent, targetEvent)) {
          conflictingEvents.push(targetEvent);
        }
      }
      
      if (conflictingEvents.length > 0) {
        conflicts.push({
          sourceEvent: adjustedSourceEvent,
          conflictingEvents: conflictingEvents
        });
      }
    }
    
    return conflicts;
  }

  private eventsOverlap(event1: EventDetails, event2: EventDetails): boolean {
    // Handle all-day events
    if (event1.isAllDay || event2.isAllDay) {
      // All-day events conflict with any event on the same day
      if (event1.isAllDay && event2.isAllDay) {
        return true; // Two all-day events always conflict
      }
      
      // All-day event conflicts with any timed event on the same day
      if (event1.isAllDay && event2.startDateTime) {
        return this.isSameDay(new Date(event2.startDateTime), new Date(event1.startDateTime || 0));
      }
      
      if (event2.isAllDay && event1.startDateTime) {
        return this.isSameDay(new Date(event1.startDateTime), new Date(event2.startDateTime || 0));
      }
    }
    
    // Handle timed events
    if (event1.startDateTime && event1.endDateTime && event2.startDateTime && event2.endDateTime) {
      const start1 = new Date(event1.startDateTime);
      const end1 = new Date(event1.endDateTime);
      const start2 = new Date(event2.startDateTime);
      const end2 = new Date(event2.endDateTime);
      
      // Check for time overlap: events overlap if one starts before the other ends
      return start1 < end2 && start2 < end1;
    }
    
    return false;
  }

  private async showConflictResolutionModal(
    conflicts: Array<{sourceEvent: EventDetails, conflictingEvents: EventDetails[]}>,
    sourceDate: Date,
    targetDate: Date
  ): Promise<EventDetails[] | null> {
    return new Promise((resolve) => {
      // Create modal overlay
      const overlay = document.createElement('div');
      overlay.className = 'gct-modal-overlay';
      
      // Create modal container
      const modal = document.createElement('div');
      modal.className = 'gct-modal gct-conflict-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-labelledby', 'gct-conflict-title');
      modal.setAttribute('aria-modal', 'true');
      
      // Track resolution decisions
      const resolutions = new Map<string, 'skip' | 'overwrite' | 'copy-anyway'>();
      
      // Set default resolution to 'copy-anyway' for all conflicts
      conflicts.forEach(conflict => {
        resolutions.set(conflict.sourceEvent.id, 'copy-anyway');
      });
      
      // Create modal content
      modal.innerHTML = `
        <div class="gct-modal-header">
          <h2 id="gct-conflict-title" class="gct-modal-title">Resolve Event Conflicts</h2>
          <button class="gct-modal-close" aria-label="Close modal">×</button>
        </div>
        <div class="gct-modal-body gct-conflict-body">
          <p class="gct-conflict-description">
            Found ${conflicts.length} event conflict(s) when copying to <strong>${this.formatDisplayDate(targetDate)}</strong>.
            Choose how to handle each conflict:
          </p>
          <div class="gct-conflicts-list">
            ${conflicts.map(conflict => this.renderConflictItem(conflict, resolutions)).join('')}
          </div>
          <div class="gct-bulk-actions">
            <label class="gct-bulk-label">Bulk Actions:</label>
            <button class="gct-bulk-btn" data-action="skip-all">Skip All</button>
            <button class="gct-bulk-btn" data-action="overwrite-all">Overwrite All</button>
            <button class="gct-bulk-btn" data-action="copy-all">Copy All Anyway</button>
          </div>
        </div>
        <div class="gct-modal-footer">
          <button class="gct-btn gct-btn-secondary" id="gct-conflict-cancel">Cancel</button>
          <button class="gct-btn gct-btn-primary" id="gct-conflict-confirm">Apply Resolutions</button>
        </div>
      `;
      
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      
      // Get elements
      const cancelBtn = modal.querySelector('#gct-conflict-cancel') as HTMLButtonElement;
      const confirmBtn = modal.querySelector('#gct-conflict-confirm') as HTMLButtonElement;
      const closeBtn = modal.querySelector('.gct-modal-close') as HTMLButtonElement;
      
      // Event handlers for resolution buttons
      modal.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        if (target.name && target.name.startsWith('conflict-')) {
          const eventId = target.name.replace('conflict-', '');
          resolutions.set(eventId, target.value as 'skip' | 'overwrite' | 'copy-anyway');
          this.updateConflictPreview(eventId, target.value, modal);
        }
      });
      
      // Bulk action handlers
      modal.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('gct-bulk-btn')) {
          const action = target.getAttribute('data-action');
          if (action) {
            this.applyBulkAction(action, conflicts, resolutions, modal);
          }
        }
      });
      
      // Close modal function
      const closeModal = (result: EventDetails[] | null = null) => {
        document.body.removeChild(overlay);
        resolve(result);
      };
      
      // Event listeners
      confirmBtn.addEventListener('click', () => {
        const finalEvents = this.processResolutions(conflicts, resolutions);
        closeModal(finalEvents);
      });
      
      cancelBtn.addEventListener('click', () => {
        closeModal(null);
      });
      
      closeBtn.addEventListener('click', () => {
        closeModal(null);
      });
      
      // Close on overlay click
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          closeModal(null);
        }
      });
      
      // Close on ESC key
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          closeModal(null);
          document.removeEventListener('keydown', handleKeyDown);
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      
      // Focus management
      setTimeout(() => {
        confirmBtn.focus();
      }, 100);
      
      this.log('Conflict resolution modal displayed');
    });
  }

  private renderConflictItem(
    conflict: {sourceEvent: EventDetails, conflictingEvents: EventDetails[]},
    resolutions: Map<string, 'skip' | 'overwrite' | 'copy-anyway'>
  ): string {
    const sourceEvent = conflict.sourceEvent;
    const eventId = sourceEvent.id;
    const currentResolution = resolutions.get(eventId) || 'copy-anyway';
    
    const timeDisplay = sourceEvent.isAllDay 
      ? 'All day' 
      : `${this.formatTime(sourceEvent.startDateTime)} - ${this.formatTime(sourceEvent.endDateTime)}`;
    
    const conflictList = conflict.conflictingEvents
      .map(event => {
        const conflictTime = event.isAllDay 
          ? 'All day' 
          : `${this.formatTime(event.startDateTime)} - ${this.formatTime(event.endDateTime)}`;
        return `<li class="gct-conflict-item">${event.title} (${conflictTime})</li>`;
      })
      .join('');
    
    return `
      <div class="gct-conflict" data-event-id="${eventId}">
        <div class="gct-conflict-event">
          <h4 class="gct-conflict-title">${sourceEvent.title}</h4>
          <p class="gct-conflict-time">${timeDisplay}</p>
          <div class="gct-conflict-details">
            <p class="gct-conflict-label">Conflicts with:</p>
            <ul class="gct-conflicts-existing">${conflictList}</ul>
          </div>
        </div>
        <div class="gct-conflict-resolution">
          <div class="gct-radio-group">
            <label class="gct-radio-option">
              <input type="radio" name="conflict-${eventId}" value="skip" ${currentResolution === 'skip' ? 'checked' : ''}>
              <span class="gct-radio-label">Skip - Don't copy this event</span>
            </label>
            <label class="gct-radio-option">
              <input type="radio" name="conflict-${eventId}" value="overwrite" ${currentResolution === 'overwrite' ? 'checked' : ''}>
              <span class="gct-radio-label">Overwrite - Replace existing event(s)</span>
            </label>
            <label class="gct-radio-option">
              <input type="radio" name="conflict-${eventId}" value="copy-anyway" ${currentResolution === 'copy-anyway' ? 'checked' : ''}>
              <span class="gct-radio-label">Copy Anyway - Allow overlap</span>
            </label>
          </div>
          <div class="gct-resolution-preview" data-preview="${eventId}">
            ${this.getResolutionPreview(currentResolution, conflict)}
          </div>
        </div>
      </div>
    `;
  }

  private formatTime(dateTime: Date | null): string {
    if (!dateTime) return '';
    return new Date(dateTime).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  private updateConflictPreview(eventId: string, resolution: string, modal: HTMLElement): void {
    const previewElement = modal.querySelector(`[data-preview="${eventId}"]`);
    if (previewElement) {
      const conflict = this.findConflictByEventId(eventId);
      if (conflict) {
        previewElement.innerHTML = this.getResolutionPreview(resolution as 'skip' | 'overwrite' | 'copy-anyway', conflict);
      }
    }
  }

  private findConflictByEventId(eventId: string): {sourceEvent: EventDetails, conflictingEvents: EventDetails[]} | null {
    // This is a helper method to find conflict data when updating previews
    // In a real implementation, you'd pass this data or store it in a way that's accessible
    return null; // Simplified for now
  }

  private getResolutionPreview(resolution: 'skip' | 'overwrite' | 'copy-anyway', conflict: {sourceEvent: EventDetails, conflictingEvents: EventDetails[]}): string {
    switch (resolution) {
      case 'skip':
        return '<span class="gct-preview-skip">Event will not be copied</span>';
      case 'overwrite':
        return `<span class="gct-preview-overwrite">Will replace ${conflict.conflictingEvents.length} existing event(s)</span>`;
      case 'copy-anyway':
        return '<span class="gct-preview-copy">Event will be copied with overlap</span>';
      default:
        return '';
    }
  }

  private applyBulkAction(
    action: string,
    conflicts: Array<{sourceEvent: EventDetails, conflictingEvents: EventDetails[]}>,
    resolutions: Map<string, 'skip' | 'overwrite' | 'copy-anyway'>,
    modal: HTMLElement
  ): void {
    let resolution: 'skip' | 'overwrite' | 'copy-anyway';
    
    switch (action) {
      case 'skip-all':
        resolution = 'skip';
        break;
      case 'overwrite-all':
        resolution = 'overwrite';
        break;
      case 'copy-all':
        resolution = 'copy-anyway';
        break;
      default:
        return;
    }
    
    // Update all resolutions
    conflicts.forEach(conflict => {
      resolutions.set(conflict.sourceEvent.id, resolution);
    });
    
    // Update all radio buttons
    conflicts.forEach(conflict => {
      const radioButtons = modal.querySelectorAll(`input[name="conflict-${conflict.sourceEvent.id}"]`) as NodeListOf<HTMLInputElement>;
      radioButtons.forEach(radio => {
        radio.checked = radio.value === resolution;
      });
      
      // Update preview
      this.updateConflictPreview(conflict.sourceEvent.id, resolution, modal);
    });
  }

  private processResolutions(
    conflicts: Array<{sourceEvent: EventDetails, conflictingEvents: EventDetails[]}>,
    resolutions: Map<string, 'skip' | 'overwrite' | 'copy-anyway'>
  ): EventDetails[] {
    const finalEvents: EventDetails[] = [];
    
    conflicts.forEach(conflict => {
      const resolution = resolutions.get(conflict.sourceEvent.id) || 'copy-anyway';
      
      switch (resolution) {
        case 'skip':
          // Don't add to final events
          this.log(`Skipping event: ${conflict.sourceEvent.title}`);
          break;
        case 'overwrite':
        case 'copy-anyway':
          // Add to final events (overwrite logic will be handled in copy phase)
          finalEvents.push(conflict.sourceEvent);
          this.log(`Will copy event: ${conflict.sourceEvent.title} (${resolution})`);
          break;
      }
    });
    
    return finalEvents;
  }

  private async copyEventsToTargetDay(
    eventsToProcess: EventDetails[], 
    targetDate: Date, 
    conflicts: Array<{sourceEvent: EventDetails, conflictingEvents: EventDetails[]}>
  ): Promise<{successful: EventDetails[], failed: Array<{event: EventDetails, error: string}>}> {
    const results = {
      successful: [] as EventDetails[],
      failed: [] as Array<{event: EventDetails, error: string}>
    };

    this.log(`Starting bulk copy of ${eventsToProcess.length} events to ${targetDate.toDateString()}`);

    // Show progress notification
    this.showNotification(
      `Copying ${eventsToProcess.length} event(s) to ${targetDate.toDateString()}...`,
      'info'
    );

    for (let i = 0; i < eventsToProcess.length; i++) {
      const event = eventsToProcess[i];
      
      try {
        this.log(`Processing event ${i + 1}/${eventsToProcess.length}: ${event.title}`);
        
        // Find if this event had conflicts that require overwriting
        const eventConflict = conflicts.find(c => c.sourceEvent.id === event.id);
        const hasOverwriteConflicts = eventConflict && eventConflict.conflictingEvents.length > 0;
        
        // Handle overwrite conflicts by deleting existing events first
        if (hasOverwriteConflicts) {
          this.log(`Event "${event.title}" requires overwriting ${eventConflict.conflictingEvents.length} existing event(s)`);
          
          for (const conflictingEvent of eventConflict.conflictingEvents) {
            try {
              await this.deleteEvent(conflictingEvent);
              this.log(`Successfully deleted conflicting event: ${conflictingEvent.title}`);
            } catch (deleteError) {
              this.error(`Failed to delete conflicting event: ${conflictingEvent.title}`, deleteError as Error);
              // Continue with duplication even if deletion fails
            }
          }
        }
        
        // Create the duplicate event on the target date
        await this.createDuplicateEvent(event, targetDate, event.calendarId || 'primary');
        
        results.successful.push(event);
        this.log(`✅ Successfully copied event: ${event.title}`);
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.failed.push({ event, error: errorMessage });
        this.error(`❌ Failed to copy event: ${event.title}`, error as Error);
      }
      
      // Add small delay between events to avoid overwhelming Google Calendar
      if (i < eventsToProcess.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    this.log(`Copy operation completed. Success: ${results.successful.length}, Failed: ${results.failed.length}`);
    
    // Refresh calendar view to show new events
    try {
      await this.refreshCalendarView();
    } catch (refreshError) {
      this.error('Failed to refresh calendar view after copying', refreshError as Error);
    }

    return results;
  }

  private async deleteEvent(eventDetails: EventDetails): Promise<void> {
    // This is a simplified implementation - in a production environment,
    // you would need to use Google Calendar API to properly delete events
    this.log(`Placeholder: Would delete event "${eventDetails.title}" (ID: ${eventDetails.id})`);
    
    // For now, we'll just log the deletion attempt
    // In a real implementation, this would:
    // 1. Find the event in the DOM
    // 2. Open its context menu or detail view
    // 3. Click the delete button
    // 4. Confirm the deletion
    // OR use the Google Calendar API directly
    
    // Add a small delay to simulate the deletion process
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  private async showTargetDaySelectionModal(sourceDate: Date): Promise<Date | null> {
    return new Promise((resolve) => {
      // Create modal overlay
      const overlay = document.createElement('div');
      overlay.className = 'gct-modal-overlay';
      
      // Create modal container
      const modal = document.createElement('div');
      modal.className = 'gct-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-labelledby', 'gct-modal-title');
      modal.setAttribute('aria-modal', 'true');
      
      // Format source date for display
      const sourceDateStr = this.formatDisplayDate(sourceDate);
      
      // Create modal content
      modal.innerHTML = `
        <div class="gct-modal-header">
          <h2 id="gct-modal-title" class="gct-modal-title">Copy Events</h2>
          <button class="gct-modal-close" aria-label="Close modal">×</button>
        </div>
        <div class="gct-modal-body">
          <p class="gct-modal-description">
            Copy all events from <strong>${sourceDateStr}</strong> to:
          </p>
          <div class="gct-modal-form">
            <label for="gct-target-date" class="gct-form-label">Target Date:</label>
            <input 
              type="date" 
              id="gct-target-date" 
              class="gct-form-input"
              required
              aria-describedby="gct-date-error"
            />
            <div id="gct-date-error" class="gct-error-message" role="alert" aria-live="polite"></div>
          </div>
        </div>
        <div class="gct-modal-footer">
          <button class="gct-btn gct-btn-secondary" id="gct-cancel-btn">Cancel</button>
          <button class="gct-btn gct-btn-primary" id="gct-confirm-btn">Copy Events</button>
        </div>
      `;
      
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      
      // Get form elements
      const dateInput = modal.querySelector('#gct-target-date') as HTMLInputElement;
      const errorDiv = modal.querySelector('#gct-date-error') as HTMLElement;
      const confirmBtn = modal.querySelector('#gct-confirm-btn') as HTMLButtonElement;
      const cancelBtn = modal.querySelector('#gct-cancel-btn') as HTMLButtonElement;
      const closeBtn = modal.querySelector('.gct-modal-close') as HTMLButtonElement;
      
      // Set default date to tomorrow
      const tomorrow = new Date(sourceDate);
      tomorrow.setDate(tomorrow.getDate() + 1);
      dateInput.value = this.formatDateForInput(tomorrow);
      
      // Validation function
      const validateDate = (): boolean => {
        const selectedDate = new Date(dateInput.value);
        errorDiv.textContent = '';
        
        if (!dateInput.value) {
          errorDiv.textContent = 'Please select a target date';
          return false;
        }
        
        if (isNaN(selectedDate.getTime())) {
          errorDiv.textContent = 'Please select a valid date';
          return false;
        }
        
        if (this.isSameDay(selectedDate, sourceDate)) {
          errorDiv.textContent = 'Target date cannot be the same as source date';
          return false;
        }
        
        return true;
      };
      
      // Close modal function
      const closeModal = (result: Date | null = null) => {
        document.body.removeChild(overlay);
        resolve(result);
      };
      
      // Event listeners
      confirmBtn.addEventListener('click', () => {
        if (validateDate()) {
          const selectedDate = new Date(dateInput.value);
          closeModal(selectedDate);
        }
      });
      
      cancelBtn.addEventListener('click', () => {
        closeModal();
      });
      
      closeBtn.addEventListener('click', () => {
        closeModal();
      });
      
      // Close on overlay click
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          closeModal();
        }
      });
      
      // Close on ESC key
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          closeModal();
          document.removeEventListener('keydown', handleKeyDown);
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      
      // Real-time validation
      dateInput.addEventListener('input', validateDate);
      
      // Focus management
      setTimeout(() => {
        dateInput.focus();
      }, 100);
      
      this.log('Target day selection modal displayed');
    });
  }

  private async showCopyResultsModal(
    copyResults: {successful: EventDetails[], failed: Array<{event: EventDetails, error: string}>},
    sourceDate: Date,
    targetDate: Date,
    allProcessedEvents: EventDetails[],
    conflicts: Array<{sourceEvent: EventDetails, conflictingEvents: EventDetails[]}>
  ): Promise<void> {
    return new Promise((resolve) => {
      const { successful, failed } = copyResults;
      const totalEvents = allProcessedEvents.length;
      const skippedEvents = totalEvents - successful.length - failed.length;
      const overwrittenCount = conflicts.reduce((count, conflict) => 
        count + (successful.some(s => s.id === conflict.sourceEvent.id) ? conflict.conflictingEvents.length : 0), 0
      );

      // Create modal HTML
      const modalHTML = `
        <div class="gct-modal-overlay" id="gct-copy-results-overlay">
          <div class="gct-modal gct-copy-results-modal" role="dialog" aria-labelledby="gct-copy-results-title" aria-modal="true">
            <div class="gct-modal-header">
              <h2 id="gct-copy-results-title" class="gct-modal-title">
                Copy Day Results
              </h2>
              <button class="gct-modal-close" aria-label="Close dialog">&times;</button>
            </div>
            
            <div class="gct-copy-results-body">
              <div class="gct-copy-summary">
                <div class="gct-copy-date-info">
                  <span class="gct-copy-from">${this.formatDisplayDate(sourceDate)}</span>
                  <span class="gct-copy-arrow">→</span>
                  <span class="gct-copy-to">${this.formatDisplayDate(targetDate)}</span>
                </div>
                
                <div class="gct-copy-stats">
                  <div class="gct-stat-item gct-stat-success">
                    <span class="gct-stat-number">${successful.length}</span>
                    <span class="gct-stat-label">Copied</span>
                  </div>
                  ${failed.length > 0 ? `
                    <div class="gct-stat-item gct-stat-error">
                      <span class="gct-stat-number">${failed.length}</span>
                      <span class="gct-stat-label">Failed</span>
                    </div>
                  ` : ''}
                  ${skippedEvents > 0 ? `
                    <div class="gct-stat-item gct-stat-warning">
                      <span class="gct-stat-number">${skippedEvents}</span>
                      <span class="gct-stat-label">Skipped</span>
                    </div>
                  ` : ''}
                  ${overwrittenCount > 0 ? `
                    <div class="gct-stat-item gct-stat-info">
                      <span class="gct-stat-number">${overwrittenCount}</span>
                      <span class="gct-stat-label">Overwritten</span>
                    </div>
                  ` : ''}
                </div>
              </div>

              ${successful.length > 0 ? `
                <div class="gct-result-section">
                  <h3 class="gct-result-title gct-result-title-success">
                    <span class="gct-result-icon">✓</span>
                    Successfully Copied Events
                  </h3>
                  <div class="gct-result-list">
                    ${successful.map(event => `
                      <div class="gct-result-item gct-result-item-success">
                        <span class="gct-event-title">${this.escapeHtml(event.title)}</span>
                        ${event.startDateTime ? `
                          <span class="gct-event-time">
                            ${event.isAllDay ? 'All day' : this.formatTime(event.startDateTime)}
                          </span>
                        ` : ''}
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}

              ${failed.length > 0 ? `
                <div class="gct-result-section">
                  <h3 class="gct-result-title gct-result-title-error">
                    <span class="gct-result-icon">⚠</span>
                    Failed to Copy
                  </h3>
                  <div class="gct-result-list">
                    ${failed.map(({ event, error }) => `
                      <div class="gct-result-item gct-result-item-error">
                        <span class="gct-event-title">${this.escapeHtml(event.title)}</span>
                        <span class="gct-event-error">${this.escapeHtml(error)}</span>
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}

              ${totalEvents === 0 ? `
                <div class="gct-result-section">
                  <div class="gct-no-events">
                    <span class="gct-result-icon">ℹ</span>
                    <span>No events were found on ${this.formatDisplayDate(sourceDate)} to copy.</span>
                  </div>
                </div>
              ` : ''}
            </div>
            
            <div class="gct-modal-footer">
              <button class="gct-btn gct-btn-primary" id="gct-copy-results-done">
                Done
              </button>
              <button class="gct-btn gct-btn-secondary" id="gct-copy-results-view-calendar">
                View Calendar
              </button>
            </div>
          </div>
        </div>
      `;

      // Insert modal into DOM
      document.body.insertAdjacentHTML('beforeend', modalHTML);
      
      const overlay = document.getElementById('gct-copy-results-overlay')!;
      const modal = overlay.querySelector('.gct-modal')!;
      const closeBtn = overlay.querySelector('.gct-modal-close')!;
      const doneBtn = document.getElementById('gct-copy-results-done')!;
      const viewCalendarBtn = document.getElementById('gct-copy-results-view-calendar')!;

      // Focus management
      const focusableElements = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      const firstFocusable = focusableElements[0] as HTMLElement;
      const lastFocusable = focusableElements[focusableElements.length - 1] as HTMLElement;

      // Event handlers
      const closeModal = () => {
        overlay.remove();
        resolve();
      };

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          closeModal();
        } else if (e.key === 'Tab') {
          if (e.shiftKey) {
            if (document.activeElement === firstFocusable) {
              lastFocusable.focus();
              e.preventDefault();
            }
          } else {
            if (document.activeElement === lastFocusable) {
              firstFocusable.focus();
              e.preventDefault();
            }
          }
        }
      };

      const viewCalendar = () => {
        // Navigate to the target date in Google Calendar
        const year = targetDate.getFullYear();
        const month = targetDate.getMonth() + 1; // JavaScript months are 0-indexed
        const day = targetDate.getDate();
        const targetDateString = `${year}/${month}/${day}`;
        window.location.href = `https://calendar.google.com/calendar/u/0/r/day/${targetDateString}`;
        closeModal();
      };

      // Attach event listeners
      closeBtn.addEventListener('click', closeModal);
      doneBtn.addEventListener('click', closeModal);
      viewCalendarBtn.addEventListener('click', viewCalendar);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
      });
      document.addEventListener('keydown', handleKeyDown);

      // Focus the first focusable element
      firstFocusable.focus();

      // Cleanup event listener when modal is closed
      const originalResolve = resolve;
      resolve = () => {
        document.removeEventListener('keydown', handleKeyDown);
        originalResolve();
      };

      this.log('Copy results modal displayed');
    });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private formatDisplayDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  private formatDateForInput(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private isSameDay(date1: Date, date2: Date): boolean {
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getDate() === date2.getDate();
  }

  private async handleEventDuplicate(eventId: string): Promise<void> {
    try {
      this.log(`Starting duplicate workflow for event: ${eventId}`);
      
      // Validate that we have the event card
      const eventCard = this.eventCards.get(eventId);
      if (!eventCard) {
        this.error(`Event card not found for ID: ${eventId}`);
        this.showNotification('Error: Event not found', 'error');
        return;
      }

      // Check if event card still exists in DOM
      if (!document.contains(eventCard.element)) {
        this.error(`Event card no longer exists in DOM: ${eventId}`);
        this.eventCards.delete(eventId);
        this.showNotification('Error: Event no longer available', 'error');
        return;
      }

      // Show initial feedback
      this.showNotification('Opening event details...', 'info');
      
      // Open event detail popover by clicking the event card
      await this.openEventDetailPopover(eventCard.element);
      
      // Extract event details from the popover
      const eventDetails = await this.extractEventDetails(eventId);
      
      // Proceed with duplication
      await this.duplicateEventToTomorrow(eventDetails);
      
    } catch (error) {
      this.error('Error in duplicate workflow', error as Error);
      this.showNotification('Error: Failed to duplicate event', 'error');
    }
  }

  private async openEventDetailPopover(eventElement: HTMLElement): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for event popover to open'));
      }, 5000);

      // Create a MutationObserver to detect when popover appears
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            for (const node of mutation.addedNodes) {
              if (node instanceof HTMLElement) {
                // Check for popover/dialog
                const popover = node.querySelector('div[role="dialog"], div[role="region"]') || 
                              (node.matches('div[role="dialog"], div[role="region"]') ? node : null);
                
                if (popover) {
                  clearTimeout(timeout);
                  observer.disconnect();
                  this.log('Event detail popover detected');
                  // Give it a moment to fully render
                  setTimeout(() => resolve(), 200);
                  return;
                }
              }
            }
          }
        }
      });

      // Start observing
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      // Click the event to open popover
      try {
        eventElement.click();
        this.log('Clicked event to open popover');
      } catch (error) {
        clearTimeout(timeout);
        observer.disconnect();
        reject(new Error('Failed to click event element'));
      }
    });
  }

  private async extractEventDetails(eventId: string): Promise<EventDetails> {
    // Find the event detail popover
    const popover = document.querySelector('div[role="dialog"], div[role="region"]');
    if (!popover) {
      throw new Error('Event detail popover not found');
    }

    this.log('Extracting event details from popover');

    // Get the actual event element from the calendar to extract the correct date
    const eventCard = this.eventCards.get(eventId);
    const eventDate = eventCard ? this.extractEventDateFromCalendarPosition(eventCard.element) : null;

    // Extract title (usually in a prominent heading)
    const title = this.extractTitle(popover) || 'Untitled Event';
    
    // Extract time information
    const timeInfo = this.extractTimeInfo(popover, eventDate);
    
    // Extract location (usually has a location icon)
    const location = this.extractLocation(popover);
    
    // Extract description
    const description = this.extractDescription(popover);

    const calendarId = eventCard?.element ? this.extractCalendarInfo(eventCard.element, popover) : null;

    const eventDetails: EventDetails = {
      id: eventId,
      title,
      startDateTime: timeInfo.startDateTime,
      endDateTime: timeInfo.endDateTime,
      isAllDay: timeInfo.isAllDay,
      location,
      description,
      calendarId: calendarId || undefined,
    };

    this.log('Extracted event details:', eventDetails);
    return eventDetails;
  }

  private extractTitle(popover: Element): string {
    // Try multiple selectors for title
    const titleSelectors = [
      'h1', 'h2', 'h3', // Standard heading tags
      '[data-event-title]', // Custom data attribute
      '.event-title', // Common class name
      'span[role="heading"]', // ARIA heading
    ];

    for (const selector of titleSelectors) {
      const element = popover.querySelector(selector);
      if (element && element.textContent?.trim()) {
        return element.textContent.trim();
      }
    }

    // Fallback: look for the largest text element
    const allTextElements = Array.from(popover.querySelectorAll('span, div, p'));
    const largestText = allTextElements
      .filter(el => el.textContent?.trim() && el.textContent.trim().length > 3)
      .sort((a, b) => (b.textContent?.length || 0) - (a.textContent?.length || 0))[0];

    return largestText?.textContent?.trim() || 'Untitled Event';
  }

  private extractEventDateFromCalendarPosition(eventElement: HTMLElement): Date | null {
    try {
      // Try to extract date from the calendar grid position
      // Look for date information in parent elements or nearby elements
      let currentElement = eventElement;
      
      // Look for date information in the element's ancestry
      while (currentElement && currentElement !== document.body) {
        // Check for date attributes or patterns
        const dateAttr = currentElement.getAttribute('data-date') || 
                        currentElement.getAttribute('data-datekey') ||
                        currentElement.getAttribute('data-day');
        
        if (dateAttr) {
          const date = new Date(dateAttr);
          if (!isNaN(date.getTime())) {
            this.log('Found date from element attribute:', date.toDateString());
            return date;
          }
        }
        
        // Look for date patterns in nearby text
        const nearbyText = currentElement.textContent || '';
        const datePattern = /\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/;
        const dateMatch = nearbyText.match(datePattern);
        if (dateMatch) {
          const day = parseInt(dateMatch[1], 10);
          const month = this.parseMonth(dateMatch[2]);
          const year = parseInt(dateMatch[3], 10);
          const date = new Date(year, month, day);
          if (!isNaN(date.getTime())) {
            this.log('Found date from nearby text:', date.toDateString());
            return date;
          }
        }
        
        currentElement = currentElement.parentElement as HTMLElement;
      }
      
      // Try to find the date from the calendar grid structure
      // Look for column headers or grid position
      const rect = eventElement.getBoundingClientRect();
      const elementsAtPosition = document.elementsFromPoint(rect.left + rect.width / 2, rect.top);
      
      for (const element of elementsAtPosition) {
        const text = element.textContent?.trim();
        if (text && /^\d{1,2}$/.test(text)) {
          // Found a day number, try to construct the date
          const day = parseInt(text, 10);
          const currentDate = new Date();
          
          // Try to find the month/year from the current calendar view
          const monthYearElement = document.querySelector('h1, h2, [role="heading"]');
          if (monthYearElement) {
            const monthYearText = monthYearElement.textContent || '';
            const monthYearMatch = monthYearText.match(/([A-Za-z]{3,9})\s+(\d{4})/);
            if (monthYearMatch) {
              const month = this.parseMonth(monthYearMatch[1]);
              const year = parseInt(monthYearMatch[2], 10);
              const date = new Date(year, month, day);
              if (!isNaN(date.getTime())) {
                this.log('Constructed date from calendar grid:', date.toDateString());
                return date;
              }
            }
          }
          
          // Fallback: use current month/year with the found day
          const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
          if (!isNaN(date.getTime())) {
            this.log('Constructed date with current month/year:', date.toDateString());
            return date;
          }
        }
      }
      
      this.log('Could not extract date from calendar position');
      return null;
    } catch (error) {
      this.error('Error extracting date from calendar position', error as Error);
      return null;
    }
  }

  private extractTimeInfo(popover: Element, eventDate: Date | null = null): { startDateTime: Date | null, endDateTime: Date | null, isAllDay: boolean } {
    const allTextElements = Array.from(popover.querySelectorAll('span, div, p'));
    const fallbackDate = eventDate || new Date();
    
    // Combine all text to analyze
    const combinedText = allTextElements
      .map(el => el.textContent?.trim())
      .filter(text => text && text.length > 0)
      .join(' ');

    this.log(`Analyzing time text: "${combinedText}"`);
    this.log(`Using fallback date: ${fallbackDate.toDateString()}`);

    // Pattern 1: All-day events
    const allDayPattern = /All day(?: • ([A-Za-z]{3,9} \d{1,2}(?:, \d{4})?)(?: – ([A-Za-z]{3,9} \d{1,2}(?:, \d{4})?))?)?/i;
    const allDayMatch = combinedText.match(allDayPattern);
    if (allDayMatch) {
      this.log('Detected all-day event');
      const startDate = allDayMatch[1] ? this.parseDate(allDayMatch[1], fallbackDate) : fallbackDate;
      const endDate = allDayMatch[2] ? this.parseDate(allDayMatch[2], fallbackDate) : startDate;
      
      // Set times to start and end of day
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      
      return {
        startDateTime: start,
        endDateTime: end,
        isAllDay: true
      };
    }

    // Pattern 2: Multi-day timed events
    const multiDayPattern = /([A-Za-z]{3,9} \d{1,2}, \d{4}) (\d{1,2}:\d{2}\s?[AP]M)\s*[–—-]\s*([A-Za-z]{3,9} \d{1,2}, \d{4}) (\d{1,2}:\d{2}\s?[AP]M)/i;
    const multiDayMatch = combinedText.match(multiDayPattern);
    if (multiDayMatch) {
      this.log('Detected multi-day timed event');
      const startDate = this.parseDate(multiDayMatch[1], fallbackDate);
      const startTime = this.parseTime(multiDayMatch[2]);
      const endDate = this.parseDate(multiDayMatch[3], fallbackDate);
      const endTime = this.parseTime(multiDayMatch[4]);
      
      const start = this.combineDateAndTime(startDate, startTime);
      const end = this.combineDateAndTime(endDate, endTime);
      
      return {
        startDateTime: start,
        endDateTime: end,
        isAllDay: false
      };
    }

    // Pattern 3: Single-day with explicit date
    const singleDayWithDatePattern = /([A-Za-z]{3,9} \d{1,2}, \d{4}) (\d{1,2}:\d{2}\s?[AP]M)\s*[–—-]\s*(\d{1,2}:\d{2}\s?[AP]M)/i;
    const singleDayWithDateMatch = combinedText.match(singleDayWithDatePattern);
    if (singleDayWithDateMatch) {
      this.log('Detected single-day timed event with date');
      const eventDate = this.parseDate(singleDayWithDateMatch[1], fallbackDate);
      const startTime = this.parseTime(singleDayWithDateMatch[2]);
      const endTime = this.parseTime(singleDayWithDateMatch[3]);
      
      const start = this.combineDateAndTime(eventDate, startTime);
      const end = this.combineDateAndTime(eventDate, endTime);
      
      return {
        startDateTime: start,
        endDateTime: end,
        isAllDay: false
      };
    }

    // Pattern 4: Simple time range (same day, no date specified)
    const timeRangePattern = /(\d{1,2}:\d{2}\s?[AP]M)\s*[–—-]\s*(\d{1,2}:\d{2}\s?[AP]M)/i;
    const timeRangeMatch = combinedText.match(timeRangePattern);
    if (timeRangeMatch) {
      this.log('Detected simple time range');
      const startTime = this.parseTime(timeRangeMatch[1]);
      const endTime = this.parseTime(timeRangeMatch[2]);
      
      const start = this.combineDateAndTime(fallbackDate, startTime);
      const end = this.combineDateAndTime(fallbackDate, endTime);
      
      return {
        startDateTime: start,
        endDateTime: end,
        isAllDay: false
      };
    }

    // Pattern 5: 24-hour format
    const time24Pattern = /(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})/;
    const time24Match = combinedText.match(time24Pattern);
    if (time24Match) {
      this.log('Detected 24-hour time format');
      const startTime = this.parseTime24(time24Match[1]);
      const endTime = this.parseTime24(time24Match[2]);
      
      const start = this.combineDateAndTime(fallbackDate, startTime);
      const end = this.combineDateAndTime(fallbackDate, endTime);
      
      return {
        startDateTime: start,
        endDateTime: end,
        isAllDay: false
      };
    }

    // Pattern 6: Single time (no end time)
    const singleTimePattern = /(\d{1,2}:\d{2}\s?[AP]M)/i;
    const singleTimeMatch = combinedText.match(singleTimePattern);
    if (singleTimeMatch) {
      this.log('Detected single time (no end time)');
      const startTime = this.parseTime(singleTimeMatch[1]);
      const start = this.combineDateAndTime(fallbackDate, startTime);
      
      // Default to 1-hour duration
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      
      return {
        startDateTime: start,
        endDateTime: end,
        isAllDay: false
      };
    }

    this.log('No time pattern found, defaulting to all-day');
    // Default to all-day if no time pattern is found
    const start = new Date(fallbackDate);
    start.setHours(0, 0, 0, 0);
    
    const end = new Date(fallbackDate);
    end.setHours(23, 59, 59, 999);
    
    return {
      startDateTime: start,
      endDateTime: end,
      isAllDay: true
    };
  }

  private parseDate(dateStr: string, fallbackDate: Date): Date {
    // Handle various date formats
    const normalizedDateStr = dateStr.trim();
    
    // Pattern: "Dec 25, 2024"
    const fullDatePattern = /([A-Za-z]{3,9}) (\d{1,2}), (\d{4})/;
    const fullDateMatch = normalizedDateStr.match(fullDatePattern);
    if (fullDateMatch) {
      const month = this.parseMonth(fullDateMatch[1]);
      const day = parseInt(fullDateMatch[2], 10);
      const year = parseInt(fullDateMatch[3], 10);
      return new Date(year, month, day);
    }

    // Pattern: "Dec 25" (current year assumed)
    const shortDatePattern = /([A-Za-z]{3,9}) (\d{1,2})/;
    const shortDateMatch = normalizedDateStr.match(shortDatePattern);
    if (shortDateMatch) {
      const month = this.parseMonth(shortDateMatch[1]);
      const day = parseInt(shortDateMatch[2], 10);
      const year = fallbackDate.getFullYear();
      return new Date(year, month, day);
    }

    // Fallback to provided date
    return new Date(fallbackDate);
  }

  private parseMonth(monthStr: string): number {
    const months: { [key: string]: number } = {
      'jan': 0, 'january': 0,
      'feb': 1, 'february': 1,
      'mar': 2, 'march': 2,
      'apr': 3, 'april': 3,
      'may': 4,
      'jun': 5, 'june': 5,
      'jul': 6, 'july': 6,
      'aug': 7, 'august': 7,
      'sep': 8, 'september': 8,
      'oct': 9, 'october': 9,
      'nov': 10, 'november': 10,
      'dec': 11, 'december': 11
    };
    
    const normalized = monthStr.toLowerCase();
    return months[normalized] ?? 0;
  }

  private parseTime(timeStr: string): { hours: number, minutes: number } {
    // Parse 12-hour format: "10:30 AM", "2:15 PM"
    const timePattern = /(\d{1,2}):(\d{2})\s?([AP]M)/i;
    const match = timeStr.match(timePattern);
    
    if (match) {
      let hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const ampm = match[3].toUpperCase();
      
      // Convert to 24-hour format
      if (ampm === 'PM' && hours !== 12) {
        hours += 12;
      } else if (ampm === 'AM' && hours === 12) {
        hours = 0;
      }
      
      return { hours, minutes };
    }
    
    // Fallback
    return { hours: 0, minutes: 0 };
  }

  private parseTime24(timeStr: string): { hours: number, minutes: number } {
    // Parse 24-hour format: "14:30", "09:15"
    const timePattern = /(\d{1,2}):(\d{2})/;
    const match = timeStr.match(timePattern);
    
    if (match) {
      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      return { hours, minutes };
    }
    
    // Fallback
    return { hours: 0, minutes: 0 };
  }

  private combineDateAndTime(date: Date, time: { hours: number, minutes: number }): Date {
    const combined = new Date(date);
    combined.setHours(time.hours, time.minutes, 0, 0);
    return combined;
  }

  private extractLocation(popover: Element): string {
    // Look for location indicators
    const locationIndicators = [
      'location_on', // Material icon
      'place', // Alternative icon
      'Location', // Text label
    ];

    const allElements = Array.from(popover.querySelectorAll('*'));
    
    for (const element of allElements) {
      const text = element.textContent || element.innerHTML;
      
      // Check if this element or its siblings indicate location
      if (locationIndicators.some(indicator => text.includes(indicator))) {
        // Look for the actual location text in nearby elements
        const siblings = [
          element.nextElementSibling,
          element.parentElement?.nextElementSibling,
          element.parentElement?.parentElement?.nextElementSibling
        ];
        
        for (const sibling of siblings) {
          if (sibling && sibling.textContent?.trim() && 
              !locationIndicators.some(indicator => sibling.textContent!.includes(indicator))) {
            return sibling.textContent.trim();
          }
        }
      }
    }

    return '';
  }

  private extractDescription(popover: Element): string {
    // Look for description areas
    const descriptionSelectors = [
      '[data-event-description]',
      '.event-description',
      '.description',
      'div[aria-label*="Description"]',
      'div[aria-label*="description"]',
    ];

    for (const selector of descriptionSelectors) {
      const element = popover.querySelector(selector);
      if (element && element.textContent?.trim()) {
        return element.textContent.trim();
      }
    }

    return '';
  }

  private extractCalendarInfo(eventElement: HTMLElement, popover: Element): string | null {
    // Method 1: Extract from event card element
    const calendarIdFromCard = this.extractCalendarFromEventCard(eventElement);
    if (calendarIdFromCard) {
      this.log('Found calendar ID from event card:', calendarIdFromCard);
      return calendarIdFromCard;
    }

    // Method 2: Extract from popover content
    const calendarIdFromPopover = this.extractCalendarFromPopover(popover);
    if (calendarIdFromPopover) {
      this.log('Found calendar ID from popover:', calendarIdFromPopover);
      return calendarIdFromPopover;
    }

    this.log('Could not extract calendar information from event');
    return null;
  }

  private extractCalendarFromEventCard(eventElement: HTMLElement): string | null {
    // Try to extract calendar info from the event card element
    
    // Look for data attributes that might contain calendar info
    const possibleCalendarAttrs = [
      'data-calendar-id',
      'data-calendar',
      'data-cal-id',
      'data-calendar-name'
    ];
    
    for (const attr of possibleCalendarAttrs) {
      const value = eventElement.getAttribute(attr);
      if (value) {
        return value;
      }
    }
    
    // Try to extract from parent elements
    let currentElement = eventElement;
    while (currentElement && currentElement !== document.body) {
      for (const attr of possibleCalendarAttrs) {
        const value = currentElement.getAttribute(attr);
        if (value) {
          return value;
        }
      }
      currentElement = currentElement.parentElement as HTMLElement;
    }
    
    // Try to extract from CSS classes that might indicate calendar
    const classList = eventElement.classList;
    for (const className of classList) {
      // Look for patterns like "calendar-xyz" or "cal-xyz"
      const calendarMatch = className.match(/^(?:calendar|cal)[-_](.+)$/);
      if (calendarMatch) {
        return calendarMatch[1];
      }
    }
    
    // Try to extract from event color/style
    const computedStyle = window.getComputedStyle(eventElement);
    const backgroundColor = computedStyle.backgroundColor;
    
    // Map common calendar colors to calendar names (this is a fallback)
    const colorToCalendar: { [key: string]: string } = {
      'rgb(66, 133, 244)': 'primary', // Google blue
      'rgb(219, 68, 55)': 'personal', // Red
      'rgb(15, 157, 88)': 'work', // Green
      'rgb(255, 193, 7)': 'family', // Yellow
      'rgb(156, 39, 176)': 'other', // Purple
    };
    
    if (backgroundColor && colorToCalendar[backgroundColor]) {
      return colorToCalendar[backgroundColor];
    }
    
    return null;
  }

  private extractCalendarFromPopover(popover: Element): string | null {
    // Method 1: Look for calendar email addresses directly
    const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    const popoverText = popover.textContent || '';
    const emailMatches = popoverText.match(emailPattern);
    
    if (emailMatches) {
      // Filter out obvious non-calendar emails
      const calendarEmails = emailMatches.filter(email => 
        !email.includes('noreply') && 
        !email.includes('mail') && 
        !email.includes('support')
      );
      
      if (calendarEmails.length > 0) {
        this.log('Found calendar email address:', calendarEmails[0]);
        return calendarEmails[0];
      }
    }
    
    // Method 2: Look for "organiser:" pattern specifically
    const organiserPattern = /(?:event\s*)?organiser:\s*([a-zA-Z][a-zA-Z0-9]*)/i;
    const organiserMatch = popoverText.match(organiserPattern);
    
    if (organiserMatch && organiserMatch[1]) {
      let calendarName = organiserMatch[1].trim();
      
      // Handle cases where the name is repeated like "FamilyFamilyCreated"
      // Look for the pattern where a word is repeated and followed by "Created"
      const repeatedPattern = /^([a-zA-Z]+)\1(Created|Family)?/i;
      const repeatedMatch = calendarName.match(repeatedPattern);
      
      if (repeatedMatch && repeatedMatch[1]) {
        calendarName = repeatedMatch[1];
        this.log('Found repeated calendar name, using first occurrence:', calendarName);
      }
      
      this.log('Found calendar name from organiser pattern:', calendarName);
      return calendarName.toLowerCase();
    }
    
    // Method 3: Look for specific calendar names in the content
    const knownCalendars = ['family', 'peter', 'background', 'work', 'personal', 'home', 'business'];
    const lowerText = popoverText.toLowerCase();
    
    for (const calendar of knownCalendars) {
      // Look for the calendar name followed by common indicators
      const patterns = [
        new RegExp(`\\b${calendar}\\b.*?created`, 'i'),
        new RegExp(`\\b${calendar}\\b.*?organis`, 'i'),
        new RegExp(`organis.*?\\b${calendar}\\b`, 'i')
      ];
      
      for (const pattern of patterns) {
        if (lowerText.match(pattern)) {
          this.log('Found calendar name from known patterns:', calendar);
          return calendar;
        }
      }
    }
    
    this.log('No calendar information found in popover');
    return null;
  }

  private async duplicateEventToTomorrow(eventDetails: EventDetails): Promise<void> {
    this.log('Starting event duplication process', eventDetails);
    
    try {
      // Get the event element to extract the local calendar date
      const eventElement = document.querySelector(`[data-eventid="${eventDetails.id}"]`) as HTMLElement;
      
      // Extract the local date from the calendar position (what the user sees)
      let eventDate: Date;
      if (eventElement) {
        const extractedDate = this.extractEventDateFromCalendarPosition(eventElement);
        if (extractedDate) {
          eventDate = extractedDate;
          this.log('Using extracted local date:', eventDate.toDateString());
        } else {
          this.log('Could not extract date from calendar position, using event details date');
          eventDate = eventDetails.startDateTime || new Date();
        }
      } else {
        this.log('Event element not found, using event details date');
        eventDate = eventDetails.startDateTime || new Date();
      }

      this.log('Event date (local):', eventDate.toDateString());
      
      // Calculate tomorrow relative to the event date (not current date)
      const tomorrow = new Date(eventDate);
      tomorrow.setDate(tomorrow.getDate() + 1);
      this.log('Tomorrow (relative to local event date):', tomorrow.toDateString());

      // Extract the real Google Calendar ID from the page context
      const realCalendarId = this.extractRealCalendarId(eventDetails.calendarId);
      this.log('Real calendar ID extracted:', realCalendarId);

      // Create the duplicate event with the correct calendar ID
      await this.createDuplicateEvent(eventDetails, tomorrow, realCalendarId);
      
    } catch (error) {
      this.error('Error creating duplicate event', error as Error);
      this.health.failedEnhancements++;
      this.showNotification('Error: Failed to create duplicate event', 'error');
      throw error;
    }
  }

  private extractRealCalendarId(calendarName?: string): string {
    // Method 1: Extract from page's global calendar data
    try {
      const calendarData = this.extractCalendarDataFromPage();
      if (calendarData && calendarName) {
        const matchingCalendar = calendarData.find(cal => 
          cal.name.toLowerCase() === calendarName.toLowerCase() ||
          cal.displayName?.toLowerCase() === calendarName.toLowerCase()
        );
        if (matchingCalendar) {
          this.log(`Found real calendar ID for "${calendarName}":`, matchingCalendar.id);
          return matchingCalendar.id;
        }
      }
    } catch (error) {
      this.log('Could not extract calendar data from page:', error);
    }

    // Method 2: Extract from URL parameters or page context
    try {
      // Check if we're in a specific calendar view
      const urlParams = new URLSearchParams(window.location.search);
      const srcParam = urlParams.get('src');
      if (srcParam) {
        this.log('Found calendar ID from URL:', srcParam);
        return srcParam;
      }

      // Check for calendar selection in the UI
      const selectedCalendar = document.querySelector('[data-calendar-id][aria-selected="true"], [data-calendar-id].selected');
      if (selectedCalendar) {
        const calendarId = selectedCalendar.getAttribute('data-calendar-id');
        if (calendarId) {
          this.log('Found calendar ID from selected UI element:', calendarId);
          return calendarId;
        }
      }
    } catch (error) {
      this.log('Could not extract calendar ID from URL/UI:', error);
    }

    // Method 3: Use the user's primary email as fallback
    const userEmail = this.extractUserEmail();
    if (userEmail) {
      this.log('Using user email as calendar ID:', userEmail);
      return userEmail;
    }

    // Final fallback
    this.log('Using "primary" as calendar ID fallback');
    return 'primary';
  }

  private extractCalendarDataFromPage(): Array<{id: string, name: string, displayName?: string}> | null {
    try {
      // Try to extract calendar data from Google Calendar's global objects
      const global = window as any;
      
      // Method 1: Check for calendar list in global scope
      if (global._docs_calendar_data || global.calendar_data) {
        const calendarData = global._docs_calendar_data || global.calendar_data;
        if (Array.isArray(calendarData)) {
          return calendarData.map(cal => ({
            id: cal.id || cal.calendarId,
            name: cal.name || cal.summary || cal.title,
            displayName: cal.displayName || cal.summaryOverride
          }));
        }
      }

      // Method 2: Extract from script tags containing calendar configuration
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const script of scripts) {
        const content = script.textContent || '';
        
        // Look for calendar configuration patterns
        const calendarPatterns = [
          /"calendars":\s*(\[[\s\S]*?\])/,
          /"calendarList":\s*(\[[\s\S]*?\])/,
          /calendars\s*:\s*(\[[\s\S]*?\])/
        ];

        for (const pattern of calendarPatterns) {
          const match = content.match(pattern);
          if (match) {
            try {
              const calendars = JSON.parse(match[1]);
              if (Array.isArray(calendars)) {
                return calendars.map(cal => ({
                  id: cal.id || cal.calendarId,
                  name: cal.name || cal.summary || cal.title,
                  displayName: cal.displayName || cal.summaryOverride
                }));
              }
            } catch (parseError) {
              this.log('Failed to parse calendar JSON:', parseError);
            }
          }
        }
      }

      return null;
    } catch (error) {
      this.log('Error extracting calendar data from page:', error);
      return null;
    }
  }

  private extractUserEmail(): string | null {
    try {
      // Method 1: Extract from Google account info
      const accountElements = document.querySelectorAll('[data-email], [aria-label*="@"]');
      for (const element of accountElements) {
        const email = element.getAttribute('data-email') || 
                     element.getAttribute('aria-label')?.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/)?.[1];
        if (email && email.includes('@')) {
          return email;
        }
      }

      // Method 2: Extract from page scripts
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const script of scripts) {
        const content = script.textContent || '';
        const emailMatch = content.match(/"email":\s*"([^"]+@[^"]+)"/);
        if (emailMatch) {
          return emailMatch[1];
        }
      }

      return null;
    } catch (error) {
      this.log('Error extracting user email:', error);
      return null;
    }
  }

  private async createDuplicateEvent(eventDetails: EventDetails, targetDate: Date, calendarId: string): Promise<void> {
    // Use Google Calendar's native "Duplicate" button - this preserves the original calendar
    const duplicateResult = await this.useNativeDuplicate(eventDetails, targetDate);
    
    if (duplicateResult.created) {
      if (duplicateResult.dateAdjusted) {
        this.showNotification(
          `Event "${eventDetails.title}" duplicated to tomorrow!\n\n✅ Successfully created in "${eventDetails.calendarId || 'original'}" calendar with correct date.`,
          'success'
        );
      } else {
        this.showNotification(
          `Event "${eventDetails.title}" duplicated!\n\n✅ Created in "${eventDetails.calendarId || 'original'}" calendar.\n⚠️ Please check the date and adjust if needed.`,
          'info'
        );
      }
      
      // Close popover and refresh
      await this.closeEventPopover();
      await this.refreshCalendarView();
      this.health.totalEnhanced++;
    } else {
      // Fallback to URL method only if native duplicate completely failed
      await this.createEventViaURL(eventDetails);
      
      const calendarName = eventDetails.calendarId || 'unknown';
      this.showNotification(
        `Event "${eventDetails.title}" created!\n\n⚠️ Please move it to your "${calendarName}" calendar:\n1. Click the new event\n2. Click "Edit"\n3. Change calendar to "${calendarName}"\n4. Save`,
        'info'
      );
      
      await this.closeEventPopover();
      await this.refreshCalendarView();
    }
  }

  private async useNativeDuplicate(eventDetails: EventDetails, targetDate: Date): Promise<{created: boolean, dateAdjusted: boolean}> {
    try {
      // Find the current popover
      const popover = document.querySelector('div[role="dialog"], div[role="region"]');
      if (!popover) {
        this.log('No popover found for native duplicate');
        return {created: false, dateAdjusted: false};
      }

      // Look for the "Duplicate" button
      const duplicateButton = this.findDuplicateButton(popover);
      if (!duplicateButton) {
        this.log('No Duplicate button found in popover');
        return {created: false, dateAdjusted: false};
      }

      this.log('Found Duplicate button, clicking it');
      
      // Click the duplicate button
      duplicateButton.click();
      
      // OPTIMIZED: Use faster, more efficient dialog detection
      let eventDialog = null;
      
      // First, try immediate detection (most dialogs appear instantly)
      eventDialog = this.findEventDialog();
      
      if (!eventDialog) {
        // If not found immediately, use optimized polling with shorter intervals
        const maxAttempts = 20; // 20 attempts
        const intervalMs = 100;  // 100ms intervals = max 2 seconds total
        
        for (let i = 0; i < maxAttempts && !eventDialog; i++) {
          await new Promise(resolve => setTimeout(resolve, intervalMs));
          eventDialog = this.findEventDialog();
          
          if (eventDialog) {
            this.log(`Event dialog found after ${(i + 1) * intervalMs}ms`);
            break;
          }
        }
      } else {
        this.log('Event dialog found immediately');
      }
      
      if (eventDialog) {
        this.log('Event creation dialog appeared after clicking duplicate');
        
        // Try to adjust the date in the dialog to tomorrow
        const dateAdjusted = await this.adjustDateInEventDialog(eventDialog, targetDate);
        
        // Try to save the event - attempt save regardless of date adjustment
        const saved = await this.saveEventInDialog(eventDialog);
        
        if (saved) {
          if (dateAdjusted) {
            this.log('Successfully duplicated and adjusted event to tomorrow');
            return {created: true, dateAdjusted: true};
          } else {
            this.log('Successfully duplicated event, but date adjustment failed - event created for original date');
            return {created: true, dateAdjusted: false};
          }
        } else {
          this.log('Event dialog appeared but failed to save - canceling to avoid wrong date');
          // Try to close the dialog to avoid creating event with wrong date
          const closeButton = eventDialog.querySelector('button[aria-label*="cancel"], button[aria-label*="close"]') as HTMLElement;
          if (closeButton) {
            closeButton.click();
            this.log('Canceled event dialog');
          }
          return {created: false, dateAdjusted: false};
        }
      } else {
        this.log('No event creation dialog appeared after clicking duplicate button');
        return {created: false, dateAdjusted: false};
      }
      
    } catch (error) {
      this.error('Error in native duplicate operation', error as Error);
      return {created: false, dateAdjusted: false};
    }
  }

  // OPTIMIZED: Separate method for finding event dialog with comprehensive selectors
  private findEventDialog(): Element | null {
    // Look for various dialog patterns in order of specificity
    const dialogSelectors = [
      // Most specific: dialogs with title inputs (event creation/edit)
      'div[role="dialog"]:has(input[aria-label*="Title"])',
      'div[role="dialog"]:has(input[aria-label*="title"])',
      'div[role="dialog"]:has(button[aria-label*="Save"])',
      'div[role="dialog"]:has(button[aria-label*="save"])',
      'div[role="dialog"]:has(input[value*="test"])',
      
      // Medium specificity: dialogs with controllers (Google Calendar patterns)
      'div[jscontroller]:has(input[aria-label*="Title"])',
      'div[jscontroller]:has(input[aria-label*="title"])',
      '[data-is-touch-wrapper] div:has(input[aria-label*="Title"])',
      '[data-is-touch-wrapper] div:has(input[aria-label*="title"])',
      
      // Lower specificity: any dialog (fallback)
      'div[role="dialog"]'
    ];
    
    for (const selector of dialogSelectors) {
      try {
        const dialog = document.querySelector(selector);
        if (dialog) {
          // Verify it's actually an event dialog by checking for typical event form elements
          const hasEventElements = dialog.querySelector('input[aria-label*="title"], input[aria-label*="Title"], button[aria-label*="save"], button[aria-label*="Save"]');
          if (hasEventElements) {
            return dialog;
          }
        }
      } catch (e) {
        // Some selectors might fail in older browsers, continue to next
        continue;
      }
    }
    
    return null;
  }

  private findDuplicateButton(popover: Element): HTMLElement | null {
    // Look for text that contains "Duplicate"
    const allElements = Array.from(popover.querySelectorAll('*'));
    
    for (const element of allElements) {
      const text = (element.textContent || '').toLowerCase().trim();
      
      // Look for exact "duplicate" text
      if (text === 'duplicate') {
        // Find the clickable element (button, div with role="button", etc.)
        let clickableElement = element as HTMLElement;
        
        // Check if the element itself is clickable
        if (element.tagName === 'BUTTON' || 
            element.getAttribute('role') === 'button' ||
            element.hasAttribute('onclick') ||
            window.getComputedStyle(element as HTMLElement).cursor === 'pointer') {
          return clickableElement;
        } else {
          // Look for a clickable parent
          let parent = element.parentElement;
          while (parent && parent !== popover) {
            if (parent.tagName === 'BUTTON' || 
                parent.getAttribute('role') === 'button' ||
                parent.hasAttribute('onclick') ||
                window.getComputedStyle(parent).cursor === 'pointer') {
              return parent;
            }
            parent = parent.parentElement;
          }
        }
      }
    }
    
    // Also look for generic buttons that might be the duplicate button
    const buttons = Array.from(popover.querySelectorAll('button, [role="button"]'));
    for (const button of buttons) {
      const text = (button.textContent || '').toLowerCase();
      const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
      
      if (text.includes('duplicate') || ariaLabel.includes('duplicate')) {
        return button as HTMLElement;
      }
    }
    
    this.log('Could not find Duplicate button in popover');
    return null;
  }

  private async adjustDateInEventDialog(dialog: Element, targetDate: Date): Promise<boolean> {
    try {
      this.log('Looking for date inputs in dialog');
      
      // Look for date input fields with various selectors
      const dateSelectors = [
        'input[type="date"]',
        'input[aria-label*="date"]', 
        'input[aria-label*="Date"]',
        'input[placeholder*="date"]',
        'input[data-initial-value]',
        'input[jsname]',
        'input[aria-describedby]'
      ];
      
      for (const selector of dateSelectors) {
        const dateInputs = Array.from(dialog.querySelectorAll(selector)) as HTMLInputElement[];
        this.log(`Found ${dateInputs.length} inputs with selector: ${selector}`);
        
        for (const dateInput of dateInputs) {
          this.log(`Checking input - value: "${dateInput.value}", type: "${dateInput.type}", aria-label: "${dateInput.getAttribute('aria-label')}"`);
          
          // Check if this is a date input by aria-label and value format
          const ariaLabel = (dateInput.getAttribute('aria-label') || '').toLowerCase();
          const isDateInput = ariaLabel.includes('date') && 
                              !ariaLabel.includes('time') && 
                              dateInput.value && 
                              dateInput.value.match(/\d+\s+\w+\s+\d{4}/); // "10 Jul 2025" format
          
          if (isDateInput) {
            // Format target date as "DD MMM YYYY" to match Google Calendar's format
            const targetDateStr = this.formatDateForGoogleCalendar(targetDate);
            
            this.log(`Adjusting date from "${dateInput.value}" to "${targetDateStr}"`);
            
            // OPTIMIZED: Use instant date setting instead of slow typing
            const originalValue = dateInput.value;
            
            // Focus the input
            dateInput.focus();
            
            // Set the value directly using multiple approaches for maximum compatibility
            const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (descriptor && descriptor.set) {
              descriptor.set.call(dateInput, targetDateStr);
            } else {
              dateInput.value = targetDateStr;
            }
            
            // Trigger input events to simulate user interaction - all at once, no delays
            const inputEvent = new Event('input', { bubbles: true, cancelable: true });
            const changeEvent = new Event('change', { bubbles: true, cancelable: true });
            const focusEvent = new Event('focus', { bubbles: true, cancelable: true });
            const blurEvent = new Event('blur', { bubbles: true, cancelable: true });
            
            // Fire events in sequence without delays
            dateInput.dispatchEvent(focusEvent);
            dateInput.dispatchEvent(inputEvent);
            dateInput.dispatchEvent(changeEvent);
            
            // Also trigger React-style events for modern Google Calendar
            if ((dateInput as any)._valueTracker) {
              (dateInput as any)._valueTracker.setValue(originalValue);
            }
            
            // Trigger keyboard events that Google Calendar might be listening for
            const keydownEvent = new KeyboardEvent('keydown', { 
              key: 'Enter', 
              bubbles: true, 
              cancelable: true 
            });
            const keyupEvent = new KeyboardEvent('keyup', { 
              key: 'Enter', 
              bubbles: true, 
              cancelable: true 
            });
            
            dateInput.dispatchEvent(keydownEvent);
            dateInput.dispatchEvent(keyupEvent);
            dateInput.dispatchEvent(blurEvent);
            
            this.log(`Date input updated to: "${dateInput.value}"`);
            
            // Quick validation - no delay needed
            if (dateInput.value === targetDateStr) {
              this.log('Date successfully updated and verified');
              return true;
            } else {
              this.log(`Date update verification failed - expected: "${targetDateStr}", actual: "${dateInput.value}"`);
            }
          }
        }
      }
      
      this.log('No date input found or successfully updated');
      return false;
    } catch (error) {
      this.log('Could not adjust date in event dialog', error);
      return false;
    }
  }

  private formatDateForGoogleCalendar(date: Date): string {
    // Format as "DD MMM YYYY" to match Google Calendar's input format
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    
    return `${day} ${month} ${year}`;
  }

  private async saveEventInDialog(dialog: Element): Promise<boolean> {
    try {
      this.log('Looking for save button in dialog');
      
      // Look for save/create button with various approaches
      const buttonSelectors = [
        'button[aria-label*="Save"]',
        'button:contains("Save")',
        'button[data-mdc-dialog-action="save"]',
        'button[type="submit"]',
        'div[role="button"][aria-label*="Save"]',
        'button',
        '[role="button"]'
      ];
      
      // Also look by text content
      const allButtons = Array.from(dialog.querySelectorAll('button, [role="button"]')) as HTMLElement[];
      this.log(`Found ${allButtons.length} buttons/clickable elements in dialog`);
      
      for (const button of allButtons) {
        const text = (button.textContent || '').toLowerCase().trim();
        const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
        
        this.log(`Button text: "${text}", aria-label: "${ariaLabel}"`);
        
        if (text === 'save' || 
            text.includes('save') ||
            ariaLabel.includes('save') ||
            text === 'create' ||
            text.includes('create') ||
            ariaLabel.includes('create') ||
            text === 'done' ||
            ariaLabel.includes('done')) {
          
          this.log(`Clicking save button: "${button.textContent?.trim()}" (aria-label: "${button.getAttribute('aria-label')}")`);
          
          // OPTIMIZED: Use immediate click with faster verification
          button.scrollIntoView();
          button.focus();
          button.click();
          
          // Fast verification using shorter intervals
          const verifySuccess = await this.waitForDialogClose(dialog, 100, 30); // 100ms × 30 = 3 seconds max
          
          if (verifySuccess) {
            this.log('Dialog closed after clicking save - success');
            return true;
          } else {
            this.log('Dialog still open after clicking save button');
          }
        }
      }
      
      // If no explicit save button found, try the first blue/primary button
      const primaryButtons = allButtons.filter(btn => {
        const styles = window.getComputedStyle(btn);
        return styles.backgroundColor.includes('rgb(26, 115, 232)') || // Google blue
               btn.classList.contains('primary') ||
               btn.classList.contains('mdc-button--raised');
      });
      
      if (primaryButtons.length > 0) {
        this.log('Trying primary/blue button as save button');
        primaryButtons[0].click();
        
        const verifySuccess = await this.waitForDialogClose(dialog, 100, 30);
        
        if (verifySuccess) {
          this.log('Dialog closed after clicking primary button - success');
          return true;
        }
      }
      
      this.log('No working save button found in event dialog');
      return false;
    } catch (error) {
      this.log('Could not save event in dialog', error);
      return false;
    }
  }

  // OPTIMIZED: Helper method for efficient dialog close verification
  private async waitForDialogClose(dialog: Element, intervalMs: number, maxAttempts: number): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
      if (!document.contains(dialog)) {
        return true; // Dialog was closed
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return false; // Dialog still open after timeout
  }

  private async createEventInBackground(eventDetails: EventDetails, targetDate?: Date): Promise<void> {
    this.log('Creating event in background', eventDetails);
    
    try {
      // If we have a target date, adjust the event for that date
      let adjustedEventDetails = eventDetails;
      if (targetDate) {
        adjustedEventDetails = this.adjustEventForNewDate(eventDetails, targetDate);
      }
      
      // Try to use Google Calendar's internal API if available
      if ((window as any).gapi && (window as any).gapi.client) {
        await this.createEventWithGAPI(adjustedEventDetails, targetDate);
      } else {
        // Fallback: Use direct fetch to Google Calendar API
        await this.createEventWithFetch(adjustedEventDetails, targetDate);
      }
      
      // Show success notification with calendar information
      const originalCalendar = eventDetails.calendarId || 'Unknown';
      let notificationMessage = `Event "${eventDetails.title}" duplicated to tomorrow!`;
      
      // If the original event was from a custom calendar, inform the user
      if (eventDetails.calendarId && eventDetails.calendarId !== 'primary') {
        notificationMessage += `\n\n⚠️ Note: Created in your primary calendar. Original was in "${originalCalendar}" calendar.`;
      }
      
      this.showNotification(notificationMessage, 'success');
      
      // Close the current popover
      await this.closeEventPopover();
      
      // Refresh the calendar view to show the new event
      await this.refreshCalendarView();
      
      // Update health metrics
      this.health.totalEnhanced++;
      
    } catch (error) {
      this.error('Error creating event in background', error as Error);
      throw error;
    }
  }

  private async createEventWithFetch(eventDetails: EventDetails, targetDate?: Date): Promise<void> {
    // Build event object for logging
    const eventObj = {
      summary: eventDetails.title,
      start: this.formatEventDateTime(eventDetails.startDateTime, eventDetails.isAllDay),
      end: this.formatEventDateTime(eventDetails.endDateTime, eventDetails.isAllDay),
      location: eventDetails.location,
      description: eventDetails.description ? `${eventDetails.description}\n\n[Duplicated by Google Calendar Tools]` : '[Duplicated by Google Calendar Tools]'
    };

    this.log('Event to be created:', eventObj);
    
    // Create the event using Google Calendar's authenticated API
    try {
      await this.createEventViaGoogleCalendarAPI(eventDetails, targetDate);
      this.log('Event creation API call completed');
    } catch (apiError) {
      this.log('API method failed, trying URL-based creation', apiError);
      // Fallback to URL-based creation
      await this.createEventViaURL(eventDetails, targetDate);
    }
  }

  private async createEventViaGoogleCalendarAPI(eventDetails: EventDetails, targetDate?: Date): Promise<void> {
    // Use the extracted calendar ID from the original event, or fall back to primary
    let calendarId = 'primary';
    
    // Normalize the calendar ID to proper format
    if (eventDetails.calendarId) {
      const normalizedId = this.normalizeCalendarId(eventDetails.calendarId);
      if (normalizedId !== 'primary') {
        calendarId = normalizedId;
      } else {
        this.log('Using primary calendar for API call since custom calendar ID cannot be determined');
      }
    }
    
    this.log('Using calendar ID for duplication:', calendarId);
    
    // Build the event payload
    const eventPayload = {
      summary: eventDetails.title,
      start: this.formatEventDateTime(eventDetails.startDateTime, eventDetails.isAllDay),
      end: this.formatEventDateTime(eventDetails.endDateTime, eventDetails.isAllDay),
      location: eventDetails.location || '',
      description: eventDetails.description ? `${eventDetails.description}\n\n[Duplicated by Google Calendar Tools]` : '[Duplicated by Google Calendar Tools]',
    };
    
    this.log('Event to be created:', eventPayload);
    
    // Get the access token
    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      throw new Error('No access token found');
    }
    
    // Create the event using Google Calendar API
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventPayload),
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorData}`);
    }
    
    const result = await response.json();
    this.log('Event created successfully:', result);
  }

  private async createEventViaURL(eventDetails: EventDetails, targetDate?: Date): Promise<void> {
    // Create event by programmatically filling and submitting Google Calendar's form
    const eventUrl = this.buildEventCreateUrl(eventDetails, targetDate);
    
    // Create a hidden iframe that loads the event creation page
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.style.position = 'absolute';
    iframe.style.left = '-9999px';
    iframe.style.top = '-9999px';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    
    document.body.appendChild(iframe);
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        document.body.removeChild(iframe);
        reject(new Error('Timeout creating event via URL'));
      }, 15000);

      iframe.onload = () => {
        try {
          // Wait a moment for the page to load completely
          setTimeout(() => {
            // Try to auto-submit the form if possible
            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (iframeDoc) {
              // Look for save button and click it
              const saveButton = iframeDoc.querySelector('[data-action="save"], [aria-label*="Save"], button[type="submit"]');
              if (saveButton) {
                (saveButton as HTMLElement).click();
                this.log('Auto-clicked save button');
              }
            }
            
            // Clean up
            setTimeout(() => {
              clearTimeout(timeout);
              if (iframe.parentElement) {
                document.body.removeChild(iframe);
              }
              resolve();
            }, 3000);
          }, 2000);
        } catch (error) {
          clearTimeout(timeout);
          document.body.removeChild(iframe);
          reject(error);
        }
      };

      iframe.onerror = () => {
        clearTimeout(timeout);
        document.body.removeChild(iframe);
        reject(new Error('Error loading event creation page'));
      };

      // Load the event creation URL
      iframe.src = eventUrl;
    });
  }

  private extractGoogleApiKey(): string | null {
    // Try to extract API key from the page
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const content = script.textContent || '';
      const match = content.match(/['"]AIza[A-Za-z0-9_-]{35}['"]/);
      if (match) {
        return match[0].slice(1, -1); // Remove quotes
      }
    }
    return null;
  }

  private extractAccessToken(): string | null {
    // Try to extract access token from various sources
    
    // Check localStorage
    try {
      const authData = localStorage.getItem('google_auth_token') || 
                     localStorage.getItem('auth_token') ||
                     localStorage.getItem('access_token');
      if (authData) {
        const parsed = JSON.parse(authData);
        return parsed.access_token || parsed.token || authData;
      }
    } catch (e) {
      // Continue to other methods
    }

    // Check sessionStorage
    try {
      const sessionAuth = sessionStorage.getItem('google_auth_token') || 
                         sessionStorage.getItem('auth_token') ||
                         sessionStorage.getItem('access_token');
      if (sessionAuth) {
        const parsed = JSON.parse(sessionAuth);
        return parsed.access_token || parsed.token || sessionAuth;
      }
    } catch (e) {
      // Continue to other methods
    }

    // Check cookies
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name.includes('auth') || name.includes('token')) {
        if (value && value.length > 20) {
          return decodeURIComponent(value);
        }
      }
    }

    // Check if gapi is available and try to get token
    if ((window as any).gapi && (window as any).gapi.auth2) {
      try {
        const authInstance = (window as any).gapi.auth2.getAuthInstance();
        if (authInstance && authInstance.isSignedIn.get()) {
          const user = authInstance.currentUser.get();
          const authResponse = user.getAuthResponse();
          return authResponse.access_token;
        }
      } catch (e) {
        this.log('Could not extract token from gapi.auth2');
      }
    }

    return null;
  }

  private formatEventDateTime(dateTime: Date | null, isAllDay: boolean): any {
    if (!dateTime) return null;
    
    if (isAllDay) {
      return {
        date: dateTime.toISOString().split('T')[0]
      };
    } else {
      return {
        dateTime: dateTime.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      };
    }
  }

  private extractCalendarId(): string | null {
    // Try to extract calendar ID from the current URL or page
    const urlParams = new URLSearchParams(window.location.search);
    const calendarParam = urlParams.get('calendar');
    if (calendarParam) {
      return calendarParam;
    }
    
    // Try to extract from the URL path
    const pathMatch = window.location.pathname.match(/\/calendar\/u\/\d+\/r\/([^\/]+)/);
    if (pathMatch) {
      return pathMatch[1];
    }
    
    // Try to extract from selected calendar in sidebar
    const selectedCalendar = document.querySelector('[data-calendar-id][aria-selected="true"]');
    if (selectedCalendar) {
      return selectedCalendar.getAttribute('data-calendar-id');
    }
    
    // Try to extract from active calendar
    const activeCalendar = document.querySelector('[data-calendar-id].active, [data-calendar-id][class*="selected"]');
    if (activeCalendar) {
      return activeCalendar.getAttribute('data-calendar-id');
    }
    
    this.log('Could not extract calendar ID, using primary');
    return null;
  }

  private async createEventWithGAPI(eventDetails: EventDetails, targetDate?: Date): Promise<void> {
    // This would use Google's API client if available
    this.log('GAPI not fully implemented yet, falling back to fetch method');
    await this.createEventWithFetch(eventDetails, targetDate);
  }

  private buildEventCreateUrl(eventDetails: EventDetails, targetDate?: Date): string {
    // Use the more reliable Google Calendar URL format
    const baseUrl = 'https://calendar.google.com/calendar/render';
    const params = new URLSearchParams();
    
    // Required action parameter
    params.append('action', 'TEMPLATE');
    
    // Add calendar ID only if we have a reliable one (system calendars)
    if (eventDetails.calendarId) {
      const normalizedId = this.normalizeCalendarId(eventDetails.calendarId);
      // Only include calendar ID if it's not 'primary' (which means we couldn't map it)
      if (normalizedId !== 'primary') {
        params.append('src', normalizedId);
        this.log('Using calendar ID in URL:', normalizedId);
      } else {
        this.log('Skipping calendar ID in URL - letting Google Calendar handle calendar selection');
      }
    }
    
    // Add title
    if (eventDetails.title) {
      params.append('text', eventDetails.title);
    }
    
    // Add dates in Google Calendar format (use the already adjusted times from eventDetails)
    if (eventDetails.startDateTime && eventDetails.endDateTime) {
      const dateStr = this.formatGoogleCalendarDates(
        eventDetails.startDateTime,
        eventDetails.endDateTime,
        eventDetails.isAllDay
      );
      params.append('dates', dateStr);
    }
    
    // Add location
    if (eventDetails.location) {
      params.append('location', eventDetails.location);
    }
    
    // Add description with helpful instructions
    let description = '[Duplicated by Google Calendar Tools]';
    if (eventDetails.description) {
      description += `\n\nOriginal description:\n${eventDetails.description}`;
    }
    
    // Include helpful calendar information
    if (eventDetails.calendarId) {
      description += `\n\n📅 CALENDAR NOTE: This event was originally in your "${eventDetails.calendarId}" calendar.`;
      description += `\n\nTo move this event to the correct calendar:`;
      description += `\n1. After saving, click on this event`;
      description += `\n2. Click "Edit event"`;
      description += `\n3. Change the calendar dropdown to "${eventDetails.calendarId}"`;
      description += `\n4. Click "Save"`;
    }
    
    params.append('details', description);
    
    const finalUrl = `${baseUrl}?${params.toString()}`;
    this.log('Built event creation URL:', finalUrl);
    return finalUrl;
  }
  
  private normalizeCalendarId(calendarId: string): string {
    // If it's already in email format, return as-is
    if (calendarId.includes('@')) {
      return calendarId;
    }
    
    // For special system calendars, use known IDs
    const systemCalendars: { [key: string]: string } = {
      'birthdays': '#contacts@group.v.calendar.google.com',
      'holidays': '#holiday@group.v.calendar.google.com',
      'tasks': '#tasks@group.calendar.google.com'
    };
    
    const lowerCalendarId = calendarId.toLowerCase();
    if (systemCalendars[lowerCalendarId]) {
      return systemCalendars[lowerCalendarId];
    }
    
    // For user-created calendars, we can't easily guess the ID
    // Instead, let's return null to fall back to 'primary' calendar
    // since Google will handle the calendar selection in the UI
    this.log(`Cannot normalize custom calendar ID: ${calendarId}, falling back to primary`);
    return 'primary';
  }


  private adjustEventForNewDate(eventDetails: EventDetails, targetDate: Date): EventDetails {
    const adjusted = { ...eventDetails };
    
    this.log('🔄 Adjusting event for new date:');
    this.log('  📅 Target date:', targetDate.toISOString());
    this.log('  📋 Original event:', {
      title: eventDetails.title,
      startDateTime: eventDetails.startDateTime?.toISOString(),
      endDateTime: eventDetails.endDateTime?.toISOString(),
      isAllDay: eventDetails.isAllDay
    });
    
    if (eventDetails.isAllDay) {
      // For all-day events, use target date (start of day) and calculate proper end date
      const startDate = new Date(targetDate);
      startDate.setHours(0, 0, 0, 0);
      
      // For Google Calendar API compatibility, all-day events need end date to be the next day
      // But first check if this is a multi-day all-day event
      let durationDays = 1; // Default to single day
      if (eventDetails.startDateTime && eventDetails.endDateTime) {
        const originalStart = new Date(eventDetails.startDateTime);
        originalStart.setHours(0, 0, 0, 0); // Normalize to start of day
        const originalEnd = new Date(eventDetails.endDateTime);
        originalEnd.setHours(0, 0, 0, 0); // Normalize to start of day
        
        // Calculate duration in days for multi-day events
        const diffTime = originalEnd.getTime() - originalStart.getTime();
        durationDays = Math.max(1, Math.round(diffTime / (1000 * 60 * 60 * 24)));
        
        this.log(`  📏 Original all-day event duration: ${durationDays} days`);
      }
      
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + durationDays);
      endDate.setHours(0, 0, 0, 0); // Keep end at start of next day for API compatibility
      
      adjusted.startDateTime = startDate;
      adjusted.endDateTime = endDate;
      
      this.log('  ⏰ All-day event adjusted:', {
        newStart: startDate.toISOString(),
        newEnd: endDate.toISOString(),
        durationDays: durationDays
      });
    } else if (eventDetails.startDateTime && eventDetails.endDateTime) {
      // For timed events, preserve the time but change the date
      const originalStart = new Date(eventDetails.startDateTime);
      const originalEnd = new Date(eventDetails.endDateTime);
      
      // Calculate duration
      const durationMs = originalEnd.getTime() - originalStart.getTime();
      
      // Create new start time on target date
      const newStart = new Date(targetDate);
      newStart.setHours(
        originalStart.getHours(),
        originalStart.getMinutes(),
        originalStart.getSeconds(),
        originalStart.getMilliseconds()
      );
      
      // Create new end time
      const newEnd = new Date(newStart.getTime() + durationMs);
      
      adjusted.startDateTime = newStart;
      adjusted.endDateTime = newEnd;
      
      this.log('  ⏰ Timed event adjusted:', {
        originalStart: originalStart.toISOString(),
        originalEnd: originalEnd.toISOString(),
        newStart: newStart.toISOString(),
        newEnd: newEnd.toISOString(),
        durationMs: durationMs
      });
    } else {
      // Fallback: default to 1-hour event at 9 AM tomorrow
      const defaultStart = new Date(targetDate);
      defaultStart.setHours(9, 0, 0, 0);
      
      const defaultEnd = new Date(defaultStart);
      defaultEnd.setHours(10, 0, 0, 0);
      
      adjusted.startDateTime = defaultStart;
      adjusted.endDateTime = defaultEnd;
      adjusted.isAllDay = false;
      
      this.log('  ⏰ Fallback default event created:', {
        defaultStart: defaultStart.toISOString(),
        defaultEnd: defaultEnd.toISOString()
      });
    }
    
    this.log('✅ Final adjusted event:', {
      title: adjusted.title,
      startDateTime: adjusted.startDateTime?.toISOString(),
      endDateTime: adjusted.endDateTime?.toISOString(),
      isAllDay: adjusted.isAllDay
    });
    
    return adjusted;
  }

  private buildCalendarEventUrl(eventDetails: EventDetails): string {
    // Use the more reliable Google Calendar URL format
    const baseUrl = 'https://calendar.google.com/calendar/render';
    const params = new URLSearchParams();
    
    // Required action parameter
    params.append('action', 'TEMPLATE');
    
    // Add calendar ID only if we have a reliable one (system calendars)
    if (eventDetails.calendarId) {
      const normalizedId = this.normalizeCalendarId(eventDetails.calendarId);
      // Only include calendar ID if it's not 'primary' (which means we couldn't map it)
      if (normalizedId !== 'primary') {
        params.append('src', normalizedId);
        this.log('Using calendar ID in URL:', normalizedId);
      } else {
        this.log('Skipping calendar ID in URL - letting Google Calendar handle calendar selection');
      }
    }
    
    // Add title
    if (eventDetails.title) {
      params.append('text', eventDetails.title);
    }
    
    // Add dates in Google Calendar format
    if (eventDetails.startDateTime && eventDetails.endDateTime) {
      const dateStr = this.formatGoogleCalendarDates(
        eventDetails.startDateTime,
        eventDetails.endDateTime,
        eventDetails.isAllDay
      );
      params.append('dates', dateStr);
    }
    
    // Add location
    if (eventDetails.location) {
      params.append('location', eventDetails.location);
    }
    
    // Add description with calendar hint
    let description = '[Duplicated by Google Calendar Tools]';
    if (eventDetails.calendarId) {
      description += `\n\nOriginal calendar: ${eventDetails.calendarId}`;
    }
    if (eventDetails.description) {
      description = `${eventDetails.description}\n\n${description}`;
    }
    params.append('details', description);
    
    const url = `${baseUrl}?${params.toString()}`;
    this.log('Built calendar event URL:', url);
    return url;
  }

  private formatGoogleCalendarDates(startDate: Date, endDate: Date, isAllDay: boolean): string {
    if (isAllDay) {
      // All-day events use YYYYMMDD format
      const start = this.formatDateOnly(startDate);
      const end = this.formatDateOnly(endDate);
      return `${start}/${end}`;
    } else {
      // Timed events use YYYYMMDDTHHmmssZ format (UTC)
      const start = this.formatDateTime(startDate);
      const end = this.formatDateTime(endDate);
      return `${start}/${end}`;
    }
  }

  private formatDateOnly(date: Date): string {
    // Format as YYYYMMDD
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  private formatDateTime(date: Date): string {
    // Format as YYYYMMDDTHHmmssZ (UTC)
    // Use the built-in UTC methods instead of manual timezone conversion
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    
    return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
  }

  private generateEventSummary(eventDetails: EventDetails): string {
    let summary = `Event: ${eventDetails.title}`;
    
    if (eventDetails.isAllDay) {
      summary += ' (All Day)';
    } else if (eventDetails.startDateTime) {
      const timeStr = eventDetails.startDateTime.toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      summary += ` at ${timeStr}`;
    }
    
    if (eventDetails.location) {
      summary += ` at ${eventDetails.location}`;
    }
    
    return summary;
  }

  private async closeEventPopover(): Promise<void> {
    // Close any open popovers
    const closeButtons = document.querySelectorAll('[aria-label*="Close"], [aria-label*="close"], button[aria-label*="Back"]');
    for (const button of closeButtons) {
      if (button instanceof HTMLElement && button.offsetParent !== null) {
        button.click();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // Click outside to close
    document.body.click();
  }

  private async refreshCalendarView(): Promise<void> {
    // Trigger a calendar refresh by simulating F5
    this.log('Simulating F5 refresh');
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'F5',
      code: 'F5',
      keyCode: 116,
      which: 116,
      bubbles: true
    }));
  }

  private showNotification(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
    // Create and display a toast notification
    const toast = this.createToastElement(message, type);
    
    // Add to DOM
    document.body.appendChild(toast);
    
    // Auto-remove after longer duration so user can actually read them
    const duration = type === 'error' ? 8000 : type === 'success' ? 6000 : 5000;
    setTimeout(() => {
      if (toast.parentElement) {
        // Add slide-out animation before removing
        toast.style.animation = 'gct-toast-slide-out 0.3s ease-out forwards';
        setTimeout(() => {
          if (toast.parentElement) {
            toast.remove();
          }
        }, 300);
      }
    }, duration);
    
    // Also log to console for debugging
    console.log(`[GCT Notification]: ${message}`);
  }

  private createToastElement(message: string, type: 'success' | 'error' | 'info'): HTMLElement {
    const toast = document.createElement('div');
    toast.className = `gct-toast gct-toast--${type}`;
    
    // Create icon based on type
    const icon = document.createElement('span');
    icon.className = 'gct-toast__icon';
    icon.innerHTML = this.getToastIcon(type);
    
    // Create message content
    const messageEl = document.createElement('span');
    messageEl.className = 'gct-toast__message';
    messageEl.textContent = message;
    
    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'gct-toast__close';
    closeBtn.innerHTML = '×';
    closeBtn.addEventListener('click', () => {
      if (toast.parentElement) {
        // Add slide-out animation before removing
        toast.style.animation = 'gct-toast-slide-out 0.3s ease-out forwards';
        setTimeout(() => {
          if (toast.parentElement) {
            toast.remove();
          }
        }, 300);
      }
    });
    
    // Assemble toast
    toast.appendChild(icon);
    toast.appendChild(messageEl);
    toast.appendChild(closeBtn);
    
    // Style and position the toast
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      background: ${this.getToastBackground(type)};
      color: white;
      border-radius: 8px;
      padding: 12px 16px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      font-family: 'Google Sans', 'Roboto', sans-serif;
      font-size: 14px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 8px;
      max-width: 400px;
      word-wrap: break-word;
      border-left: 4px solid ${this.getToastAccentColor(type)};
      transform: translateX(100%);
      opacity: 0;
    `;
    
    // Position multiple toasts properly
    const existingToasts = document.querySelectorAll('.gct-toast');
    if (existingToasts.length > 0) {
      const offset = existingToasts.length * 70; // 70px spacing between toasts
      toast.style.top = `${20 + offset}px`;
    }
    
    // Trigger slide-in animation after DOM insertion
    requestAnimationFrame(() => {
      toast.style.animation = 'gct-toast-slide-in 0.4s ease-out forwards';
    });
    
    return toast;
  }

  private getToastIcon(type: 'success' | 'error' | 'info'): string {
    switch (type) {
      case 'success':
        return '✓';
      case 'error':
        return '⚠';
      case 'info':
      default:
        return 'ℹ';
    }
  }

  private getToastBackground(type: 'success' | 'error' | 'info'): string {
    switch (type) {
      case 'success':
        return '#0f7b0f'; // Green
      case 'error':
        return '#d73027'; // Red
      case 'info':
      default:
        return '#1976d2'; // Blue
    }
  }

  private getToastAccentColor(type: 'success' | 'error' | 'info'): string {
    switch (type) {
      case 'success':
        return '#4caf50'; // Light green
      case 'error':
        return '#f44336'; // Light red
      case 'info':
      default:
        return '#2196f3'; // Light blue
    }
  }

  private setupDOMObserver(): void {
    if (this.observer) {
      this.observer.disconnect();
    }

    // FIXED: Simplified but fast approach
    let debounceTimer: NodeJS.Timeout | null = null;
    const DEBOUNCE_DELAY = 50; // Keep fast response time

    this.observer = new MutationObserver((mutations) => {
      // Clear existing debounce timer
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      // Process all mutations with fast debounce
      debounceTimer = setTimeout(() => {
        this.processMutations(mutations);
      }, DEBOUNCE_DELAY);
    });

    // Start observing with comprehensive configuration
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-eventid', 'class', 'style'], // Monitor relevant attributes
    });

    this.log('Enhanced DOM observer started with debouncing');
  }

  private processMutations(mutations: MutationRecord[]): void {
    try {
      let addedEvents = 0;
      let removedEvents = 0;
      const processedElements = new Set<HTMLElement>();

      for (const mutation of mutations) {
        // Handle added nodes
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLElement && !processedElements.has(node)) {
              processedElements.add(node);
              
              // Check if it's an event card directly with fallback selectors
              const selectors = [this.SELECTORS.eventCard, ...this.SELECTORS.eventCardFallbacks];
              const matchesAnySelector = selectors.some(selector => {
                try {
                  return node.matches(selector);
                } catch (error) {
                  // Selector might be invalid for this element, continue
                  return false;
                }
              });
              
              if (matchesAnySelector) {
                this.enhanceEventCardWithResilience(node);
                addedEvents++;
              }
              
              // Check if it's a day header
              const dayHeaderSelectors = [this.SELECTORS.dayHeader, ...this.SELECTORS.dayHeaderFallbacks];
              const matchesDayHeader = dayHeaderSelectors.some(selector => {
                try {
                  return node.matches(selector) && this.isValidDayHeader(node);
                } catch (error) {
                  return false;
                }
              });
              
              if (matchesDayHeader) {
                this.enhanceDayHeader(node);
              }
              
              // OPTIMIZED: Check for event cards within added node only (not entire document)
              try {
                const selectors = [this.SELECTORS.eventCard, ...this.SELECTORS.eventCardFallbacks];
                for (const selector of selectors) {
                  const eventCardsInNode = node.querySelectorAll(selector) as NodeListOf<HTMLElement>;
                  if (eventCardsInNode.length > 0) {
                    eventCardsInNode.forEach((card) => {
                      if (!processedElements.has(card)) {
                        processedElements.add(card);
                        this.enhanceEventCardWithResilience(card);
                        addedEvents++;
                      }
                    });
                    break; // Found events with this selector, no need to try others
                  }
                }
              } catch (error) {
                // Log but don't break the entire process
                this.error('Error searching for event cards in subtree', error as Error);
              }
              
              // Check for day headers within added node
              try {
                const dayHeaderSelectors = [this.SELECTORS.dayHeader, ...this.SELECTORS.dayHeaderFallbacks];
                for (const selector of dayHeaderSelectors) {
                  const dayHeadersInNode = node.querySelectorAll(selector) as NodeListOf<HTMLElement>;
                  if (dayHeadersInNode.length > 0) {
                    dayHeadersInNode.forEach((header) => {
                      if (!processedElements.has(header) && this.isValidDayHeader(header)) {
                        processedElements.add(header);
                        this.enhanceDayHeader(header);
                      }
                    });
                    break; // Found headers with this selector, no need to try others
                  }
                }
              } catch (error) {
                // Log but don't break the entire process
                this.error('Error searching for day headers in subtree', error as Error);
              }
            }
          }
          
          // Handle removed nodes (cleanup) with enhanced error handling
          for (const node of mutation.removedNodes) {
            if (node instanceof HTMLElement) {
              try {
                const eventId = node.getAttribute('data-eventid');
                if (eventId && this.eventCards.has(eventId)) {
                  this.eventCards.delete(eventId);
                  removedEvents++;
                  this.log(`Cleaned up removed event: ${eventId}`);
                }
                
                // OPTIMIZED: Check for removed event cards within the removed node only
                const selectors = [this.SELECTORS.eventCard, ...this.SELECTORS.eventCardFallbacks];
                for (const selector of selectors) {
                  try {
                    const removedCards = node.querySelectorAll(selector) as NodeListOf<HTMLElement>;
                    removedCards.forEach((card) => {
                      const cardEventId = card.getAttribute('data-eventid');
                      if (cardEventId && this.eventCards.has(cardEventId)) {
                        this.eventCards.delete(cardEventId);
                        removedEvents++;
                        this.log(`Cleaned up removed nested event: ${cardEventId}`);
                      }
                    });
                  } catch (error) {
                    // Continue with next selector if this one fails
                    continue;
                  }
                }
              } catch (error) {
                // Log but continue processing
                this.error('Error cleaning up removed node', error as Error);
              }
            }
          }
        }
        
        // Handle attribute changes (e.g., event updates, view changes)
        else if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement) {
          const target = mutation.target;
          
          try {
            // Handle event card attribute changes with fallback selectors
            const selectors = [this.SELECTORS.eventCard, ...this.SELECTORS.eventCardFallbacks];
            const matchesEventCard = selectors.some(selector => {
              try {
                return target.matches(selector);
              } catch (error) {
                return false;
              }
            });
            
            if (matchesEventCard) {
              const eventId = target.getAttribute('data-eventid');
              if (eventId && !this.eventCards.has(eventId)) {
                // Event card was modified and needs enhancement
                this.enhanceEventCardWithResilience(target);
                addedEvents++;
              }
            }
            
            // Handle calendar view changes
            if (mutation.attributeName === 'class' && this.isCalendarViewChange(target)) {
              this.log('Calendar view change detected, rescanning events');
              // OPTIMIZED: Immediate view change handling with shorter delay
              setTimeout(() => this.handleViewChange(), 100); // OPTIMIZED: 100ms instead of 500ms
            }
          } catch (error) {
            // Log but continue processing
            this.error('Error processing attribute change', error as Error);
          }
        }
      }

      // Log summary if there were changes
      if (addedEvents > 0 || removedEvents > 0) {
        this.log(`DOM changes processed: +${addedEvents} events, -${removedEvents} events`);
      }
      
      // FIXED: Always run fast scan if no events were added to ensure we don't miss anything
      if (addedEvents === 0 && mutations.length > 0) {
        // DOM changes but no events processed - run comprehensive scan to catch missed events
        this.log('DOM changes detected with no events added, running comprehensive scan');
        setTimeout(() => this.fastScanForNewEvents(), 100);
      }

    } catch (error) {
      this.error('Error processing DOM mutations', error as Error);
      // Don't let mutation processing errors break the entire observer
    }
  }

  private isCalendarViewChange(element: HTMLElement): boolean {
    // Detect calendar view changes by checking for specific class patterns
    const viewChangeIndicators = [
      'aria-label',
      'data-view',
      'jsname',
    ];
    
    return viewChangeIndicators.some(attr => element.hasAttribute(attr)) &&
           (element.closest('[role="main"]') !== null || 
            element.closest('.rSoRzd') !== null);
  }

  private handleViewChange(): void {
    try {
      this.log('Handling calendar view change - rescanning for events and day headers');
      
      // Clear existing event cards that might no longer be valid
      const existingEventIds = Array.from(this.eventCards.keys());
      let cleanedUp = 0;
      
      existingEventIds.forEach(eventId => {
        const eventCard = this.eventCards.get(eventId);
        if (eventCard && !document.contains(eventCard.element)) {
          this.eventCards.delete(eventId);
          cleanedUp++;
        }
      });
      
      if (cleanedUp > 0) {
        this.log(`Cleaned up ${cleanedUp} stale event references`);
      }
      
      // Clear existing day headers that might no longer be valid
      const existingDayHeaderIds = Array.from(this.dayHeaders.keys());
      let cleanedUpHeaders = 0;
      
      existingDayHeaderIds.forEach(headerId => {
        const dayHeader = this.dayHeaders.get(headerId);
        if (dayHeader && !document.contains(dayHeader.element)) {
          this.dayHeaders.delete(headerId);
          cleanedUpHeaders++;
        }
      });
      
      if (cleanedUpHeaders > 0) {
        this.log(`Cleaned up ${cleanedUpHeaders} stale day header references`);
      }
      
      // OPTIMIZED: Use fast scanning for immediate response
      this.fastScanForNewEvents();
      this.scanForDayHeaders(); // Re-scan day headers after view change
      
    } catch (error) {
      this.error('Error handling view change', error as Error);
    }
  }

  // FIXED: Comprehensive scanning method for reliable event detection
  private fastScanForNewEvents(): void {
    try {
      const selectors = [this.SELECTORS.eventCard, ...this.SELECTORS.eventCardFallbacks];
      let foundEvents = 0;
      let totalCards = 0;
      let enhancedEvents = 0;
      
      this.log('🔍 Starting fast scan for new events...');
      
      // First, let's do a debug scan to see what's available
      this.debugScanSelectors();
      
      // Try all selectors, don't break early
      for (const selector of selectors) {
        try {
          const eventCards = document.querySelectorAll(selector) as NodeListOf<HTMLElement>;
          totalCards += eventCards.length;
          
          if (eventCards.length > 0) {
            this.log(`Found ${eventCards.length} event cards with selector: ${selector}`);
            
            eventCards.forEach((card) => {
              const eventId = card.getAttribute('data-eventid');
              if (eventId) {
                const isTracked = this.eventCards.has(eventId);
                const hasButton = card.querySelector('.gct-duplicate-btn') !== null;
                
                if (!isTracked) {
                  this.log(`🆕 Enhancing new event: ${eventId}`);
                  this.enhanceEventCardWithResilience(card);
                  enhancedEvents++;
                } else if (!hasButton) {
                  this.log(`🔧 Re-enhancing event missing button: ${eventId}`);
                  this.enhanceEventCardWithResilience(card);
                  enhancedEvents++;
                } else {
                  this.log(`✅ Event already enhanced with button: ${eventId}`);
                }
                foundEvents++;
              } else {
                this.log(`⚠️ Event card found but missing data-eventid attribute`);
              }
            });
          }
        } catch (error) {
          this.log(`❌ Error with selector ${selector}:`, error);
          continue;
        }
      }
      
      this.log(`🎯 Fast scan complete: Found ${totalCards} total cards, processed ${foundEvents} events, enhanced ${enhancedEvents} events`);
      
      // If we found cards but enhanced nothing, that might indicate an issue
      if (totalCards > 0 && enhancedEvents === 0) {
        this.log(`⚠️ Warning: Found ${totalCards} cards but enhanced 0 events - possible selector or injection issue`);
      }
      
    } catch (error) {
      this.error('Error in fast event scanning', error as Error);
      // Fallback to regular scanning
      this.scanForEventCardsWithResilience();
    }
  }

  // Debug method to understand what's on the page
  private debugScanSelectors(): void {
    this.log('🔍 DEBUG: Scanning page for event-related elements...');
    
    // Check for any elements with data-eventid
    const allEventElements = document.querySelectorAll('[data-eventid]');
    this.log(`Found ${allEventElements.length} total elements with data-eventid`);
    
    // Check each of our selectors individually
    const selectors = [this.SELECTORS.eventCard, ...this.SELECTORS.eventCardFallbacks];
    selectors.forEach((selector, index) => {
      const elements = document.querySelectorAll(selector);
      this.log(`Selector ${index + 1} (${selector}): ${elements.length} elements`);
    });
    
    // Check for common calendar class names
    const commonClasses = ['.rSoRzd', '[role="button"]', '.gV7Drd', '[data-eventchip]'];
    commonClasses.forEach(className => {
      const elements = document.querySelectorAll(className);
      this.log(`Common class ${className}: ${elements.length} elements`);
    });
    
    // Sample a few elements to understand structure
    if (allEventElements.length > 0) {
      this.log('Sample event element structure:');
      const sample = allEventElements[0] as HTMLElement;
      this.log(`- Tag: ${sample.tagName}`);
      this.log(`- Classes: ${sample.className}`);
      this.log(`- Role: ${sample.getAttribute('role')}`);
      this.log(`- Parent tag: ${sample.parentElement?.tagName}`);
      this.log(`- Parent classes: ${sample.parentElement?.className}`);
    }
  }

  private startHealthMonitoring(): void {
    setInterval(() => {
      this.performHealthCheck();
    }, this.RESILIENCE_CONFIG.healthCheckInterval);
  }

  private performHealthCheck(): void {
    try {
      this.health.lastHealthCheck = Date.now();
      const staleThreshold = Date.now() - this.RESILIENCE_CONFIG.staleEventThreshold;
      let staleEvents = 0;
      
      this.log(`Starting health check... Current events: ${this.eventCards.size}`);
      
      // Check for stale event cards and clean up orphaned buttons
      this.eventCards.forEach((eventCard, eventId) => {
        if (eventCard.lastSeen < staleThreshold || !document.contains(eventCard.element)) {
          this.eventCards.delete(eventId);
          
          // Remove associated button and clear timeout
          const orphanedButton = document.querySelector(`.gct-duplicate-btn[data-event-id="${eventId}"]`) as any;
          if (orphanedButton) {
            if (orphanedButton._hideTimeout) {
              clearTimeout(orphanedButton._hideTimeout);
            }
            orphanedButton.remove();
          }
          
          staleEvents++;
        }
      });
      
      if (staleEvents > 0) {
        this.log(`Health check: Cleaned up ${staleEvents} stale events`);
      }
      
      // Check for stale day headers
      let staleDayHeaders = 0;
      this.dayHeaders.forEach((dayHeader, headerId) => {
        if (dayHeader.lastSeen < staleThreshold || !document.contains(dayHeader.element)) {
          this.dayHeaders.delete(headerId);
          staleDayHeaders++;
        }
      });
      
      if (staleDayHeaders > 0) {
        this.log(`Health check: Cleaned up ${staleDayHeaders} stale day headers`);
      }
      
      // FIXED: Always run comprehensive scan during health check
      this.log('Health check: Running comprehensive scan for new events and day headers');
      this.fastScanForNewEvents();
      this.scanForDayHeaders();
      
      // Check overall health
      const errorRate = this.health.failedEnhancements / Math.max(this.health.totalEnhanced, 1);
      this.health.isHealthy = errorRate < 0.1 && this.health.errorCount < this.RESILIENCE_CONFIG.maxErrorCount;
      
      this.log(`Health check completed. Events: ${this.eventCards.size}, Day headers: ${this.dayHeaders.size}, Errors: ${this.health.errorCount}, Healthy: ${this.health.isHealthy}`);
      
      // FIXED: Trigger recovery if no events found at all (might indicate broken selectors)
      if (this.eventCards.size === 0) {
        const visibleEvents = document.querySelectorAll('[data-eventid]').length;
        if (visibleEvents > 0) {
          this.log(`Health check: Found ${visibleEvents} events in DOM but none enhanced - triggering recovery`);
          this.performRecovery();
          return;
        }
      }
      
      if (!this.health.isHealthy) {
        this.log(`Health check failed: Error rate ${(errorRate * 100).toFixed(1)}%, Error count: ${this.health.errorCount}`);
        this.performRecovery();
      }
      
    } catch (error) {
      this.error('Health check failed', error as Error);
    }
  }

  private performRecovery(): void {
    this.log('Performing extension recovery');
    
    try {
      // Reset error counters
      this.health.errorCount = 0;
      this.health.failedEnhancements = 0;
      this.health.isHealthy = true;
      
      // Clean up orphaned buttons and timeouts
      const orphanedButtons = document.querySelectorAll('.gct-duplicate-btn') as NodeListOf<any>;
      orphanedButtons.forEach(button => {
        if (button._hideTimeout) {
          clearTimeout(button._hideTimeout);
        }
        button.remove();
      });
      if (orphanedButtons.length > 0) {
        this.log(`Recovery: Removed ${orphanedButtons.length} orphaned buttons`);
      }
      
      // Clear potentially corrupted state
      this.eventCards.clear();
      
      // Restart DOM observer
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      
      // Re-scan and re-enhance
      setTimeout(() => {
        this.setupDOMObserver();
        this.scanForEventCardsWithResilience();
        this.log('Recovery completed');
      }, 1000);
      
    } catch (error) {
      this.error('Recovery failed', error as Error);
    }
  }

  private attemptRecovery(): void {
    this.log('Attempting extension recovery after initialization failure');
    
    if (!this.initialized) {
      this.init();
    }
  }

  public cleanup(): void {
    this.log('Cleaning up Google Calendar Tools');
    
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    
    // Remove all injected buttons and clear timeouts
    const allButtons = document.querySelectorAll('.gct-duplicate-btn') as NodeListOf<any>;
    allButtons.forEach(button => {
      if (button._hideTimeout) {
        clearTimeout(button._hideTimeout);
      }
      button.remove();
    });
    this.log(`Removed ${allButtons.length} duplicate buttons`);
    
    // Remove custom styles
    const styleElement = document.getElementById('gct-styles');
    if (styleElement) {
      styleElement.remove();
    }
    
    // Clear event cards map
    this.eventCards.clear();
    
    this.initialized = false;
  }

  private async getAccessToken(): Promise<string | null> {
    // Try to extract access token from the page context
    const token = this.extractAccessToken();
    if (token) {
      return token;
    }
    
    // Try to get it from Chrome's identity API if available
    if (typeof chrome !== 'undefined' && chrome.identity) {
      try {
        const result = await chrome.identity.getAuthToken({ interactive: false });
        // Handle the result properly - it might be a string or an object
        if (typeof result === 'string') {
          return result;
        } else if (result && typeof result === 'object' && 'token' in result) {
          return (result as any).token;
        }
      } catch (error) {
        this.log('Failed to get auth token from Chrome identity API:', error);
      }
    }
    
    return null;
  }
}

// Global instance
let calendarTools: GoogleCalendarTools | null = null;

// Initialize when script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    calendarTools = new GoogleCalendarTools();
  });
} else {
  calendarTools = new GoogleCalendarTools();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  calendarTools?.cleanup();
});

// Make available globally for debugging
(window as any).calendarTools = calendarTools;

