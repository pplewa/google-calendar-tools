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

class GoogleCalendarTools implements CalendarExtension {
  public initialized = false;
  public observer: MutationObserver | null = null;
  private readonly DEBUG = true;
  private eventCards: Map<string, EventCard> = new Map();
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
    healthCheckInterval: 30000, // 30 seconds
    maxErrorCount: 10,
    staleEventThreshold: 300000, // 5 minutes
    enhancementTimeout: 5000, // 5 seconds max per enhancement
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
    
    // Find and enhance existing event cards
    this.scanForEventCardsWithResilience();
    
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

  private enhanceEventCardWithResilience(cardElement: HTMLElement): void {
    const startTime = Date.now();
    
    try {
      // Timeout protection for individual enhancements
      const enhancementPromise = new Promise<void>((resolve, reject) => {
        try {
          this.enhanceEventCard(cardElement);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Enhancement timeout')), this.RESILIENCE_CONFIG.enhancementTimeout);
      });
      
      Promise.race([enhancementPromise, timeoutPromise])
        .then(() => {
          this.health.totalEnhanced++;
          const duration = Date.now() - startTime;
          if (duration > 1000) {
            this.log(`Slow enhancement detected: ${duration}ms`);
          }
        })
        .catch((error) => {
          this.health.failedEnhancements++;
          this.error('Enhancement failed with timeout protection', error);
        });
        
    } catch (error) {
      this.health.failedEnhancements++;
      this.error('Enhancement failed immediately', error as Error);
    }
  }

  private enhanceEventCard(cardElement: HTMLElement): void {
    const eventId = cardElement.getAttribute('data-eventid');
    if (!eventId) {
      this.log('Event card missing data-eventid, skipping');
      return;
    }

    // Check if already enhanced
    if (this.eventCards.has(eventId)) {
      // Update last seen timestamp
      const existingCard = this.eventCards.get(eventId)!;
      existingCard.lastSeen = Date.now();
      return;
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
        background: none;
        border: none;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.2s ease, background-color 0.2s ease;
        z-index: 10;
        border-radius: 50%;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
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
        transform: translateX(100%);
        opacity: 0;
        transition: all 0.3s ease-out;
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
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      
      @keyframes gct-toast-slide-out {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
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
    `;
    
    document.head.appendChild(style);
    this.log('Custom styles injected');
  }



  private injectDuplicateButton(cardElement: HTMLElement, eventId: string): void {
    // Check if button already exists
    if (cardElement.querySelector('.gct-duplicate-btn')) return;

    const button = document.createElement('button');
    button.className = 'gct-duplicate-btn';
    button.setAttribute('data-event-id', eventId);
    button.title = 'Duplicate event to tomorrow';
    button.innerHTML = '📋';

    // Append to the card
    cardElement.appendChild(button);

    // Add event listener
    button.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent triggering the event click
      this.handleEventDuplicate(eventId);
    });
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
    this.log('  📅 Target date (tomorrow):', targetDate.toISOString());
    this.log('  📋 Original event:', {
      title: eventDetails.title,
      startDateTime: eventDetails.startDateTime?.toISOString(),
      endDateTime: eventDetails.endDateTime?.toISOString(),
      isAllDay: eventDetails.isAllDay
    });
    
    if (eventDetails.isAllDay) {
      // For all-day events, set to target date
      const startDate = new Date(targetDate);
      startDate.setHours(0, 0, 0, 0);
      
      const endDate = new Date(targetDate);
      endDate.setHours(23, 59, 59, 999);
      
      adjusted.startDateTime = startDate;
      adjusted.endDateTime = endDate;
      
      this.log('  ⏰ All-day event adjusted:', {
        newStart: startDate.toISOString(),
        newEnd: endDate.toISOString()
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
    
    // Auto-remove after duration (with different durations based on type)
    const duration = type === 'error' ? 5000 : type === 'success' ? 3000 : 2500;
    setTimeout(() => {
      if (toast.parentElement) {
        toast.remove();
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
        toast.remove();
      }
    });
    
    // Assemble toast
    toast.appendChild(icon);
    toast.appendChild(messageEl);
    toast.appendChild(closeBtn);
    
    // Add animation classes
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
      animation: gct-toast-slide-in 0.3s ease-out;
      border-left: 4px solid ${this.getToastAccentColor(type)};
    `;
    
    // Position multiple toasts properly
    const existingToasts = document.querySelectorAll('.gct-toast');
    if (existingToasts.length > 0) {
      const offset = existingToasts.length * 70; // 70px spacing between toasts
      toast.style.top = `${20 + offset}px`;
    }
    
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

    // Debouncing variables for performance optimization
    let debounceTimer: NodeJS.Timeout | null = null;
    const DEBOUNCE_DELAY = 150; // ms

    this.observer = new MutationObserver((mutations) => {
      // Clear existing debounce timer
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      // Debounce the mutation processing for performance
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
              
              // Check for event cards within added subtrees with resilience
              try {
                const eventCards = this.findElementsWithFallbacks(selectors.map(s => `${s}`));
                if (eventCards) {
                  eventCards.forEach((card) => {
                    if (!processedElements.has(card)) {
                      processedElements.add(card);
                      this.enhanceEventCardWithResilience(card);
                      addedEvents++;
                    }
                  });
                }
              } catch (error) {
                // Log but don't break the entire process
                this.error('Error searching for event cards in subtree', error as Error);
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
                
                // Also check for removed event cards in subtrees
                const selectors = [this.SELECTORS.eventCard, ...this.SELECTORS.eventCardFallbacks];
                const removedCards = this.findElementsWithFallbacks(selectors);
                if (removedCards) {
                  removedCards.forEach((card) => {
                    const cardEventId = card.getAttribute('data-eventid');
                    if (cardEventId && this.eventCards.has(cardEventId)) {
                      this.eventCards.delete(cardEventId);
                      removedEvents++;
                      this.log(`Cleaned up removed nested event: ${cardEventId}`);
                    }
                  });
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
              setTimeout(() => this.handleViewChange(), 500); // Delay to let view settle
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
      this.log('Handling calendar view change - rescanning for events');
      
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
      
      // Rescan for new events in the current view
      this.scanForEventCardsWithResilience();
      
    } catch (error) {
      this.error('Error handling view change', error as Error);
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
      
      // Check for stale event cards
      this.eventCards.forEach((eventCard, eventId) => {
        if (eventCard.lastSeen < staleThreshold || !document.contains(eventCard.element)) {
          this.eventCards.delete(eventId);
          staleEvents++;
        }
      });
      
      if (staleEvents > 0) {
        this.log(`Health check: Cleaned up ${staleEvents} stale events`);
      }
      
      // Check overall health
      const errorRate = this.health.failedEnhancements / Math.max(this.health.totalEnhanced, 1);
      this.health.isHealthy = errorRate < 0.1 && this.health.errorCount < this.RESILIENCE_CONFIG.maxErrorCount;
      
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

