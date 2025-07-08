import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DateUtils } from '../utils/dateUtils';

// Mock the chrome APIs
const mockChrome = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn()
    }
  }
};

Object.defineProperty(global, 'chrome', {
  value: mockChrome,
  writable: true
});

describe('Google Calendar Tools Integration', () => {
  let container: HTMLElement;

  beforeEach(() => {
    // Create a fresh container for each test
    container = document.createElement('div');
    container.innerHTML = `
      <div class="calendar-view">
        <div class="event-card" data-eventid="event1">
          <div class="event-title">Meeting 1</div>
          <div class="event-time">2:00 PM - 3:00 PM</div>
        </div>
        <div class="event-card" data-eventid="event2">
          <div class="event-title">Meeting 2</div>
          <div class="event-time">4:00 PM - 5:00 PM</div>
        </div>
        <div class="event-card" data-eventid="event3">
          <div class="event-title">All-day Event</div>
        </div>
      </div>
    `;
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.clearAllMocks();
  });

  describe('Event Selection', () => {
    it('should handle event selection state changes', () => {
      const eventCards = container.querySelectorAll('.event-card');
      const selectedEventIds = new Set<string>();

      // Simulate selecting events
      const selectEvent = (eventElement: Element, isSelected: boolean) => {
        const eventId = eventElement.getAttribute('data-eventid');
        if (!eventId) return;

        if (isSelected) {
          selectedEventIds.add(eventId);
          eventElement.classList.add('gct-selected-event');
        } else {
          selectedEventIds.delete(eventId);
          eventElement.classList.remove('gct-selected-event');
        }
      };

      // Select first two events
      selectEvent(eventCards[0], true);
      selectEvent(eventCards[1], true);

      expect(selectedEventIds.size).toBe(2);
      expect(selectedEventIds.has('event1')).toBe(true);
      expect(selectedEventIds.has('event2')).toBe(true);
      expect(eventCards[0].classList.contains('gct-selected-event')).toBe(true);
      expect(eventCards[1].classList.contains('gct-selected-event')).toBe(true);

      // Deselect first event
      selectEvent(eventCards[0], false);
      expect(selectedEventIds.size).toBe(1);
      expect(selectedEventIds.has('event1')).toBe(false);
      expect(eventCards[0].classList.contains('gct-selected-event')).toBe(false);
    });

    it('should handle bulk selection operations', () => {
      const eventCards = container.querySelectorAll('.event-card');
      const selectedEventIds = new Set<string>();

      // Select all events
      const selectAllEvents = () => {
        eventCards.forEach(card => {
          const eventId = card.getAttribute('data-eventid');
          if (eventId) {
            selectedEventIds.add(eventId);
            card.classList.add('gct-selected-event');
          }
        });
      };

      // Deselect all events
      const deselectAllEvents = () => {
        selectedEventIds.clear();
        eventCards.forEach(card => {
          card.classList.remove('gct-selected-event');
        });
      };

      selectAllEvents();
      expect(selectedEventIds.size).toBe(3);
      expect(Array.from(selectedEventIds)).toEqual(['event1', 'event2', 'event3']);

      deselectAllEvents();
      expect(selectedEventIds.size).toBe(0);
      eventCards.forEach(card => {
        expect(card.classList.contains('gct-selected-event')).toBe(false);
      });
    });
  });

  describe('Date Manipulation with date-fns', () => {
    it('should correctly adjust all-day events for new dates', () => {
      const originalEvent = {
        title: 'All-day Meeting',
        isAllDay: true,
        startDateTime: new Date(2024, 0, 15), // Jan 15, 2024
        endDateTime: new Date(2024, 0, 16), // Jan 16, 2024
      };

      const targetDate = new Date(2024, 1, 20); // Feb 20, 2024
      const adjustedEvent = DateUtils.adjustEventForNewDate(originalEvent, targetDate);

      expect(DateUtils.isSameDay(adjustedEvent.startDateTime, targetDate)).toBe(true);
      expect(adjustedEvent.startDateTime.getHours()).toBe(0);
      expect(adjustedEvent.startDateTime.getMinutes()).toBe(0);
      expect(DateUtils.differenceInDays(adjustedEvent.endDateTime, adjustedEvent.startDateTime)).toBe(1);
    });

    it('should correctly adjust timed events preserving duration', () => {
      const originalEvent = {
        title: 'Timed Meeting',
        isAllDay: false,
        startDateTime: new Date(2024, 0, 15, 14, 30, 0), // Jan 15, 2024, 2:30 PM
        endDateTime: new Date(2024, 0, 15, 16, 30, 0), // Jan 15, 2024, 4:30 PM (2 hours)
      };

      const targetDate = new Date(2024, 1, 20); // Feb 20, 2024
      const adjustedEvent = DateUtils.adjustEventForNewDate(originalEvent, targetDate);

      expect(DateUtils.isSameDay(adjustedEvent.startDateTime, targetDate)).toBe(true);
      expect(adjustedEvent.startDateTime.getHours()).toBe(14);
      expect(adjustedEvent.startDateTime.getMinutes()).toBe(30);
      expect(adjustedEvent.endDateTime.getHours()).toBe(16);
      expect(adjustedEvent.endDateTime.getMinutes()).toBe(30);

      // Verify duration is preserved (2 hours = 7200000 milliseconds)
      const duration = adjustedEvent.endDateTime.getTime() - adjustedEvent.startDateTime.getTime();
      expect(duration).toBe(2 * 60 * 60 * 1000); // 2 hours in milliseconds
    });

    it('should handle multi-day events correctly', () => {
      const originalEvent = {
        title: 'Multi-day Conference',
        isAllDay: true,
        startDateTime: new Date(2024, 0, 15), // Jan 15, 2024
        endDateTime: new Date(2024, 0, 18), // Jan 18, 2024 (3 days)
      };

      const targetDate = new Date(2024, 1, 20); // Feb 20, 2024
      const adjustedEvent = DateUtils.adjustEventForNewDate(originalEvent, targetDate);

      expect(DateUtils.isSameDay(adjustedEvent.startDateTime, targetDate)).toBe(true);
      expect(DateUtils.differenceInDays(adjustedEvent.endDateTime, adjustedEvent.startDateTime)).toBe(3);
    });
  });

  describe('Copy Selected Button', () => {
    it('should show/hide copy button based on selection count', () => {
      const selectedEventIds = new Set<string>();

      const updateCopyButtonVisibility = () => {
        const copyButton = document.querySelector('.gct-copy-selected-container');
        if (!copyButton) return;

        if (selectedEventIds.size > 0) {
          copyButton.classList.add('visible');
        } else {
          copyButton.classList.remove('visible');
        }

        const countBadge = copyButton.querySelector('.gct-selection-count');
        if (countBadge) {
          countBadge.textContent = selectedEventIds.size.toString();
        }
      };

      // Create copy button
      const copyButton = document.createElement('div');
      copyButton.className = 'gct-copy-selected-container';
      copyButton.innerHTML = `
        <button class="gct-copy-selected-button">
          Copy Selected (<span class="gct-selection-count">0</span>)
        </button>
      `;
      document.body.appendChild(copyButton);

      // Initially hidden
      expect(copyButton.classList.contains('visible')).toBe(false);

      // Select events
      selectedEventIds.add('event1');
      selectedEventIds.add('event2');
      updateCopyButtonVisibility();

      expect(copyButton.classList.contains('visible')).toBe(true);
      expect(copyButton.querySelector('.gct-selection-count')?.textContent).toBe('2');

      // Deselect all
      selectedEventIds.clear();
      updateCopyButtonVisibility();

      expect(copyButton.classList.contains('visible')).toBe(false);

      document.body.removeChild(copyButton);
    });
  });

  describe('URL Generation', () => {
    it('should generate correct Google Calendar URLs for all-day events', () => {
      const eventDetails = {
        title: 'All-day Event',
        isAllDay: true,
        startDateTime: new Date(2024, 0, 15),
        endDateTime: new Date(2024, 0, 16),
        location: 'Office',
        description: 'Important meeting'
      };

      const generateGoogleCalendarUrl = (event: any) => {
        const baseUrl = 'https://calendar.google.com/calendar/render';
        const params = new URLSearchParams({
          action: 'TEMPLATE',
          text: event.title,
          dates: DateUtils.formatGoogleCalendarDates(event.startDateTime, event.endDateTime, event.isAllDay),
          location: event.location || '',
          details: event.description || ''
        });

        return `${baseUrl}?${params.toString()}`;
      };

      const url = generateGoogleCalendarUrl(eventDetails);
      
      expect(url).toContain('action=TEMPLATE');
      expect(url).toContain('text=All-day+Event');
      expect(url).toContain('dates=20240115%2F20240116');
      expect(url).toContain('location=Office');
      expect(url).toContain('details=Important+meeting');
    });

    it('should generate correct Google Calendar URLs for timed events', () => {
      const eventDetails = {
        title: 'Timed Meeting',
        isAllDay: false,
        startDateTime: new Date('2024-01-15T14:30:00Z'),
        endDateTime: new Date('2024-01-15T16:30:00Z'),
        location: 'Conference Room',
        description: 'Team sync'
      };

      const generateGoogleCalendarUrl = (event: any) => {
        const baseUrl = 'https://calendar.google.com/calendar/render';
        const params = new URLSearchParams({
          action: 'TEMPLATE',
          text: event.title,
          dates: DateUtils.formatGoogleCalendarDates(event.startDateTime, event.endDateTime, event.isAllDay),
          location: event.location || '',
          details: event.description || ''
        });

        return `${baseUrl}?${params.toString()}`;
      };

      const url = generateGoogleCalendarUrl(eventDetails);
      
      expect(url).toContain('action=TEMPLATE');
      expect(url).toContain('text=Timed+Meeting');
      expect(url).toContain('dates=20240115T143000Z%2F20240115T163000Z');
      expect(url).toContain('location=Conference+Room');
      expect(url).toContain('details=Team+sync');
    });
  });

  describe('Date Picker Integration', () => {
    it('should handle date selection and validation', () => {
      const handleDateSelection = (dateString: string): Date | null => {
        if (!dateString) return null;
        
        const selectedDate = DateUtils.parseISOString(dateString + 'T00:00:00.000Z');
        return DateUtils.isValid(selectedDate) ? selectedDate : null;
      };

      // Valid date selection
      const validDate = handleDateSelection('2024-02-20');
      expect(validDate).toBeTruthy();
      expect(validDate?.getFullYear()).toBe(2024);
      expect(validDate?.getMonth()).toBe(1); // February
      expect(validDate?.getDate()).toBe(20);

      // Invalid date selection
      const invalidDate = handleDateSelection('invalid-date');
      expect(invalidDate).toBeNull();

      // Empty date selection
      const emptyDate = handleDateSelection('');
      expect(emptyDate).toBeNull();
    });

    it('should calculate tomorrow as default date', () => {
      const sourceDate = new Date(2024, 0, 15); // Jan 15, 2024
      const tomorrow = DateUtils.getTomorrow(sourceDate);
      
      expect(tomorrow.getFullYear()).toBe(2024);
      expect(tomorrow.getMonth()).toBe(0); // January
      expect(tomorrow.getDate()).toBe(16);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid dates gracefully', () => {
      const invalidEvent = {
        title: 'Invalid Event',
        isAllDay: false,
        startDateTime: new Date('invalid'),
        endDateTime: new Date('invalid'),
      };

      expect(() => {
        DateUtils.adjustEventForNewDate(invalidEvent, new Date('invalid'));
      }).toThrow('Invalid target date provided');
    });

    it('should provide fallback for events with missing time data', () => {
      const eventWithoutTimes = {
        title: 'No Times Event',
        isAllDay: false,
        startDateTime: null,
        endDateTime: null,
      };

      const targetDate = new Date(2024, 0, 20);
      const adjusted = DateUtils.adjustEventForNewDate(eventWithoutTimes, targetDate);

      expect(DateUtils.isSameDay(adjusted.startDateTime, targetDate)).toBe(true);
      expect(adjusted.startDateTime.getHours()).toBe(9); // Default 9 AM
      expect(adjusted.endDateTime.getHours()).toBe(10); // Default 10 AM
      expect(adjusted.isAllDay).toBe(false);
    });
  });

  describe('Performance and Edge Cases', () => {
    it('should handle large numbers of events efficiently', () => {
      const selectedEventIds = new Set<string>();
      const performanceTestSize = 1000;

      // Simulate selecting many events
      const startTime = performance.now();
      
      for (let i = 0; i < performanceTestSize; i++) {
        selectedEventIds.add(`event${i}`);
      }

      // Validate selections
      for (let i = 0; i < performanceTestSize; i++) {
        expect(selectedEventIds.has(`event${i}`)).toBe(true);
      }

      const endTime = performance.now();
      const executionTime = endTime - startTime;

      // Should complete in reasonable time (under 10ms for 1000 operations)
      expect(executionTime).toBeLessThan(10);
      expect(selectedEventIds.size).toBe(performanceTestSize);
    });

    it('should handle edge cases in date manipulation', () => {
      // Leap year handling
      const leapYearDate = new Date(2024, 1, 29); // Feb 29, 2024 (leap year)
      const tomorrow = DateUtils.addDays(leapYearDate, 1);
      expect(tomorrow.getDate()).toBe(1); // Should be March 1
      expect(tomorrow.getMonth()).toBe(2); // March

      // Year boundary
      const yearEnd = new Date(2024, 11, 31); // Dec 31, 2024
      const nextDay = DateUtils.addDays(yearEnd, 1);
      expect(nextDay.getFullYear()).toBe(2025);
      expect(nextDay.getMonth()).toBe(0); // January
      expect(nextDay.getDate()).toBe(1);

      // Daylight saving time (this is handled by date-fns internally)
      const dstDate = new Date(2024, 2, 10, 14, 30); // March 10, 2024, 2:30 PM
      const adjustedDst = DateUtils.setTime(DateUtils.addDays(dstDate, 1), dstDate);
      expect(adjustedDst.getHours()).toBe(14);
      expect(adjustedDst.getMinutes()).toBe(30);
    });
  });
}); 