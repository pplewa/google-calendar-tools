import { describe, it, expect } from 'vitest';
import { DateUtils } from './dateUtils';

describe('DateUtils', () => {
  // Test data
  const testDate = new Date(2024, 0, 15, 14, 30, 45, 123); // Jan 15, 2024, 2:30:45.123 PM
  const invalidDate = new Date('invalid');

  describe('formatDisplayDate', () => {
    it('should format valid date for display', () => {
      expect(DateUtils.formatDisplayDate(testDate)).toBe('January 15, 2024');
    });

    it('should handle invalid date', () => {
      expect(DateUtils.formatDisplayDate(invalidDate)).toBe('Invalid Date');
    });
  });

  describe('formatDateForInput', () => {
    it('should format valid date for HTML input', () => {
      expect(DateUtils.formatDateForInput(testDate)).toBe('2024-01-15');
    });

    it('should handle invalid date', () => {
      expect(DateUtils.formatDateForInput(invalidDate)).toBe('');
    });
  });

  describe('formatDateOnly', () => {
    it('should format date as YYYYMMDD', () => {
      expect(DateUtils.formatDateOnly(testDate)).toBe('20240115');
    });

    it('should handle invalid date', () => {
      expect(DateUtils.formatDateOnly(invalidDate)).toBe('');
    });
  });

  describe('formatDateTime', () => {
    it('should format datetime as YYYYMMDDTHHmmssZ', () => {
      // Create a specific UTC date for consistent testing across time zones
      const utcDate = new Date('2024-01-15T14:30:45Z');
      const result = DateUtils.formatDateTime(utcDate);
      expect(result).toBe('20240115T143045Z');
    });

    it('should handle invalid date', () => {
      expect(DateUtils.formatDateTime(invalidDate)).toBe('');
    });
  });

  describe('isSameDay', () => {
    it('should return true for same day', () => {
      const date1 = new Date(2024, 0, 15, 10, 0, 0);
      const date2 = new Date(2024, 0, 15, 20, 0, 0);
      expect(DateUtils.isSameDay(date1, date2)).toBe(true);
    });

    it('should return false for different days', () => {
      const date1 = new Date(2024, 0, 15);
      const date2 = new Date(2024, 0, 16);
      expect(DateUtils.isSameDay(date1, date2)).toBe(false);
    });

    it('should handle invalid dates', () => {
      expect(DateUtils.isSameDay(invalidDate, testDate)).toBe(false);
      expect(DateUtils.isSameDay(testDate, invalidDate)).toBe(false);
      expect(DateUtils.isSameDay(invalidDate, invalidDate)).toBe(false);
    });
  });

  describe('addDays', () => {
    it('should add days to a date', () => {
      const result = DateUtils.addDays(testDate, 5);
      expect(result.getDate()).toBe(20);
      expect(result.getMonth()).toBe(0); // January
      expect(result.getFullYear()).toBe(2024);
    });

    it('should handle negative days', () => {
      const result = DateUtils.addDays(testDate, -5);
      expect(result.getDate()).toBe(10);
    });

    it('should handle invalid date', () => {
      const result = DateUtils.addDays(invalidDate, 5);
      expect(isNaN(result.getTime())).toBe(true);
    });
  });

  describe('getTomorrow', () => {
    it('should get tomorrow from given date', () => {
      const result = DateUtils.getTomorrow(testDate);
      expect(result.getDate()).toBe(16);
      expect(result.getMonth()).toBe(0);
      expect(result.getFullYear()).toBe(2024);
    });

    it('should get tomorrow from today if no date provided', () => {
      const result = DateUtils.getTomorrow();
      const expectedTomorrow = new Date();
      expectedTomorrow.setDate(expectedTomorrow.getDate() + 1);
      expect(DateUtils.isSameDay(result, expectedTomorrow)).toBe(true);
    });
  });

  describe('startOfDay', () => {
    it('should get start of day', () => {
      const result = DateUtils.startOfDay(testDate);
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(0);
      expect(result.getDate()).toBe(15);
      expect(result.getHours()).toBe(0);
      expect(result.getMinutes()).toBe(0);
      expect(result.getSeconds()).toBe(0);
      expect(result.getMilliseconds()).toBe(0);
    });

    it('should handle invalid date', () => {
      const result = DateUtils.startOfDay(invalidDate);
      expect(isNaN(result.getTime())).toBe(true);
    });
  });

  describe('endOfDay', () => {
    it('should get end of day', () => {
      const result = DateUtils.endOfDay(testDate);
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(0);
      expect(result.getDate()).toBe(15);
      expect(result.getHours()).toBe(23);
      expect(result.getMinutes()).toBe(59);
      expect(result.getSeconds()).toBe(59);
      expect(result.getMilliseconds()).toBe(999);
    });

    it('should handle invalid date', () => {
      const result = DateUtils.endOfDay(invalidDate);
      expect(isNaN(result.getTime())).toBe(true);
    });
  });

  describe('differenceInDays', () => {
    it('should calculate difference in days', () => {
      const date1 = new Date(2024, 0, 15);
      const date2 = new Date(2024, 0, 20);
      expect(DateUtils.differenceInDays(date2, date1)).toBe(5);
    });

    it('should handle negative difference', () => {
      const date1 = new Date(2024, 0, 20);
      const date2 = new Date(2024, 0, 15);
      expect(DateUtils.differenceInDays(date2, date1)).toBe(-5);
    });

    it('should handle invalid dates', () => {
      expect(DateUtils.differenceInDays(invalidDate, testDate)).toBe(0);
      expect(DateUtils.differenceInDays(testDate, invalidDate)).toBe(0);
    });
  });

  describe('setTime', () => {
    it('should set time with individual parameters', () => {
      const result = DateUtils.setTime(testDate, 10, 15, 30, 500);
      expect(result.getHours()).toBe(10);
      expect(result.getMinutes()).toBe(15);
      expect(result.getSeconds()).toBe(30);
      expect(result.getMilliseconds()).toBe(500);
      expect(result.getDate()).toBe(testDate.getDate()); // Date should remain same
    });

    it('should set time with default values', () => {
      const result = DateUtils.setTime(testDate, 10);
      expect(result.getHours()).toBe(10);
      expect(result.getMinutes()).toBe(0);
      expect(result.getSeconds()).toBe(0);
      expect(result.getMilliseconds()).toBe(0);
    });

    it('should copy time from source date', () => {
      const sourceTime = new Date(2024, 5, 10, 8, 45, 20, 300);
      const result = DateUtils.setTime(testDate, sourceTime);
      expect(result.getHours()).toBe(8);
      expect(result.getMinutes()).toBe(45);
      expect(result.getSeconds()).toBe(20);
      expect(result.getMilliseconds()).toBe(300);
      expect(result.getDate()).toBe(testDate.getDate()); // Date should remain same
    });

    it('should handle invalid date', () => {
      const result = DateUtils.setTime(invalidDate, 10, 15);
      expect(isNaN(result.getTime())).toBe(true);
    });
  });

  describe('adjustEventForNewDate', () => {
    it('should adjust all-day single-day event', () => {
      const eventDetails = {
        title: 'Test Event',
        isAllDay: true,
        startDateTime: new Date(2024, 0, 10),
        endDateTime: new Date(2024, 0, 11),
      };
      
      const targetDate = new Date(2024, 0, 20);
      const result = DateUtils.adjustEventForNewDate(eventDetails, targetDate);
      
      expect(DateUtils.isSameDay(result.startDateTime, targetDate)).toBe(true);
      expect(result.startDateTime.getHours()).toBe(0);
      expect(result.startDateTime.getMinutes()).toBe(0);
      expect(DateUtils.differenceInDays(result.endDateTime, result.startDateTime)).toBe(1);
    });

    it('should adjust all-day multi-day event', () => {
      const eventDetails = {
        title: 'Multi-day Event',
        isAllDay: true,
        startDateTime: new Date(2024, 0, 10),
        endDateTime: new Date(2024, 0, 13), // 3-day event
      };
      
      const targetDate = new Date(2024, 0, 20);
      const result = DateUtils.adjustEventForNewDate(eventDetails, targetDate);
      
      expect(DateUtils.isSameDay(result.startDateTime, targetDate)).toBe(true);
      expect(DateUtils.differenceInDays(result.endDateTime, result.startDateTime)).toBe(3);
    });

    it('should adjust timed event preserving duration', () => {
      const eventDetails = {
        title: 'Timed Event',
        isAllDay: false,
        startDateTime: new Date(2024, 0, 10, 14, 30),
        endDateTime: new Date(2024, 0, 10, 16, 30), // 2-hour event
      };
      
      const targetDate = new Date(2024, 0, 20);
      const result = DateUtils.adjustEventForNewDate(eventDetails, targetDate);
      
      expect(DateUtils.isSameDay(result.startDateTime, targetDate)).toBe(true);
      expect(result.startDateTime.getHours()).toBe(14);
      expect(result.startDateTime.getMinutes()).toBe(30);
      expect(result.endDateTime.getHours()).toBe(16);
      expect(result.endDateTime.getMinutes()).toBe(30);
    });

    it('should create fallback event for missing times', () => {
      const eventDetails = {
        title: 'Event without times',
        isAllDay: false,
        startDateTime: null,
        endDateTime: null,
      };
      
      const targetDate = new Date(2024, 0, 20);
      const result = DateUtils.adjustEventForNewDate(eventDetails, targetDate);
      
      expect(DateUtils.isSameDay(result.startDateTime, targetDate)).toBe(true);
      expect(result.startDateTime.getHours()).toBe(9);
      expect(result.endDateTime.getHours()).toBe(10);
      expect(result.isAllDay).toBe(false);
    });

    it('should throw error for invalid target date', () => {
      const eventDetails = {
        title: 'Test Event',
        isAllDay: true,
        startDateTime: new Date(2024, 0, 10),
        endDateTime: new Date(2024, 0, 11),
      };
      
      expect(() => {
        DateUtils.adjustEventForNewDate(eventDetails, invalidDate);
      }).toThrow('Invalid target date provided');
    });
  });

  describe('parseISOString', () => {
    it('should parse valid ISO string', () => {
      const isoString = '2024-01-15T14:30:45.123Z';
      const result = DateUtils.parseISOString(isoString);
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(0); // January
      // Use UTC methods for consistent timezone handling
      expect(result.getUTCDate()).toBe(15);
    });

    it('should handle empty string', () => {
      const result = DateUtils.parseISOString('');
      expect(isNaN(result.getTime())).toBe(true);
    });

    it('should handle invalid ISO string', () => {
      const result = DateUtils.parseISOString('invalid-date');
      expect(isNaN(result.getTime())).toBe(true);
    });
  });

  describe('toISOString', () => {
    it('should convert date to ISO string', () => {
      const result = DateUtils.toISOString(testDate);
      expect(result).toBeTruthy();
      expect(result).toContain('2024-01-15');
    });

    it('should handle invalid date', () => {
      const result = DateUtils.toISOString(invalidDate);
      expect(result).toBe('');
    });
  });

  describe('isValid', () => {
    it('should return true for valid date', () => {
      expect(DateUtils.isValid(testDate)).toBe(true);
    });

    it('should return false for invalid date', () => {
      expect(DateUtils.isValid(invalidDate)).toBe(false);
    });
  });

  describe('formatGoogleCalendarDates', () => {
    it('should format all-day event dates', () => {
      const start = new Date(2024, 0, 15);
      const end = new Date(2024, 0, 16);
      const result = DateUtils.formatGoogleCalendarDates(start, end, true);
      expect(result).toBe('20240115/20240116');
    });

    it('should format timed event dates', () => {
      const start = new Date('2024-01-15T14:30:00Z');
      const end = new Date('2024-01-15T16:30:00Z');
      const result = DateUtils.formatGoogleCalendarDates(start, end, false);
      expect(result).toBe('20240115T143000Z/20240115T163000Z');
    });

    it('should handle invalid dates', () => {
      const result = DateUtils.formatGoogleCalendarDates(invalidDate, testDate, true);
      expect(result).toBe('');
    });
  });
}); 