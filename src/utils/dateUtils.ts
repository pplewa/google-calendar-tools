import { 
  format, 
  addDays, 
  isSameDay, 
  isValid, 
  parseISO,
  startOfDay,
  endOfDay,
  differenceInDays,
  addMilliseconds,
  setHours,
  setMinutes,
  setSeconds,
  setMilliseconds,
  formatISO
} from 'date-fns';

/**
 * Date utilities using date-fns library
 * All date calculations should go through these utilities for consistency
 */
export class DateUtils {
  /**
   * Format date for display (e.g., "January 15, 2024")
   */
  static formatDisplayDate(date: Date): string {
    if (!isValid(date)) {
      return 'Invalid Date';
    }
    return format(date, 'MMMM d, yyyy');
  }

  /**
   * Format date for HTML input (YYYY-MM-DD)
   */
  static formatDateForInput(date: Date): string {
    if (!isValid(date)) {
      return '';
    }
    return format(date, 'yyyy-MM-dd');
  }

  /**
   * Format date only as YYYYMMDD (for Google Calendar API)
   */
  static formatDateOnly(date: Date): string {
    if (!isValid(date)) {
      return '';
    }
    return format(date, 'yyyyMMdd');
  }

  /**
   * Format date time as YYYYMMDDTHHmmssZ (UTC for Google Calendar API)
   */
  static formatDateTime(date: Date): string {
    if (!isValid(date)) {
      return '';
    }
    // Use UTC methods to ensure consistent timezone handling
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    
    return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
  }

  /**
   * Check if two dates are the same day
   */
  static isSameDay(date1: Date, date2: Date): boolean {
    if (!isValid(date1) || !isValid(date2)) {
      return false;
    }
    return isSameDay(date1, date2);
  }

  /**
   * Add days to a date
   */
  static addDays(date: Date, days: number): Date {
    if (!isValid(date)) {
      return new Date(NaN);
    }
    return addDays(date, days);
  }

  /**
   * Get tomorrow's date
   */
  static getTomorrow(sourceDate: Date = new Date()): Date {
    return DateUtils.addDays(sourceDate, 1);
  }

  /**
   * Get start of day (00:00:00.000)
   */
  static startOfDay(date: Date): Date {
    if (!isValid(date)) {
      return new Date(NaN);
    }
    return startOfDay(date);
  }

  /**
   * Get end of day (23:59:59.999)
   */
  static endOfDay(date: Date): Date {
    if (!isValid(date)) {
      return new Date(NaN);
    }
    return endOfDay(date);
  }

  /**
   * Calculate difference in days between two dates
   */
  static differenceInDays(laterDate: Date, earlierDate: Date): number {
    if (!isValid(laterDate) || !isValid(earlierDate)) {
      return 0;
    }
    return differenceInDays(laterDate, earlierDate);
  }

  /**
   * Adjust event for new date while preserving time
   */
  static adjustEventForNewDate(eventDetails: any, targetDate: Date): any {
    const adjusted = { ...eventDetails };
    
    if (!isValid(targetDate)) {
      throw new Error('Invalid target date provided');
    }

    if (eventDetails.isAllDay) {
      // For all-day events, use target date (start of day) and calculate proper end date
      const startDate = DateUtils.startOfDay(targetDate);
      
      // Calculate duration in days for multi-day events
      let durationDays = 1; // Default to single day
      if (eventDetails.startDateTime && eventDetails.endDateTime) {
        const originalStart = DateUtils.startOfDay(eventDetails.startDateTime);
        const originalEnd = DateUtils.startOfDay(eventDetails.endDateTime);
        durationDays = Math.max(1, DateUtils.differenceInDays(originalEnd, originalStart));
      }
      
      const endDate = DateUtils.addDays(startDate, durationDays);
      
      adjusted.startDateTime = startDate;
      adjusted.endDateTime = endDate;
      
    } else if (eventDetails.startDateTime && eventDetails.endDateTime) {
      // For timed events, preserve the time but change the date
      const originalStart = eventDetails.startDateTime;
      const originalEnd = eventDetails.endDateTime;
      
      // Calculate duration in milliseconds
      const durationMs = originalEnd.getTime() - originalStart.getTime();
      
      // Create new start time on target date
      const newStart = DateUtils.setTime(targetDate, originalStart);
      
      // Create new end time
      const newEnd = addMilliseconds(newStart, durationMs);
      
      adjusted.startDateTime = newStart;
      adjusted.endDateTime = newEnd;
      
    } else {
      // Fallback: default to 1-hour event at 9 AM on target date
      const defaultStart = DateUtils.setTime(targetDate, 9, 0, 0, 0);
      const defaultEnd = DateUtils.setTime(targetDate, 10, 0, 0, 0);
      
      adjusted.startDateTime = defaultStart;
      adjusted.endDateTime = defaultEnd;
      adjusted.isAllDay = false;
    }
    
    return adjusted;
  }

  /**
   * Set time on a date
   */
  static setTime(date: Date, hours: number, minutes?: number, seconds?: number, milliseconds?: number): Date;
  static setTime(date: Date, sourceTime: Date): Date;
  static setTime(date: Date, hoursOrSource: number | Date, minutes?: number, seconds?: number, milliseconds?: number): Date {
    if (!isValid(date)) {
      return new Date(NaN);
    }

    if (hoursOrSource instanceof Date) {
      // Copy time from source date
      const sourceTime = hoursOrSource;
      return DateUtils.setTime(
        date,
        sourceTime.getHours(),
        sourceTime.getMinutes(),
        sourceTime.getSeconds(),
        sourceTime.getMilliseconds()
      );
    } else {
      // Set specific time values
      let result = setHours(date, hoursOrSource);
      result = setMinutes(result, minutes ?? 0);
      result = setSeconds(result, seconds ?? 0);
      result = setMilliseconds(result, milliseconds ?? 0);
      return result;
    }
  }

  /**
   * Parse ISO string to Date
   */
  static parseISOString(isoString: string): Date {
    if (!isoString) {
      return new Date(NaN);
    }
    return parseISO(isoString);
  }

  /**
   * Convert date to ISO string
   */
  static toISOString(date: Date): string {
    if (!isValid(date)) {
      return '';
    }
    return formatISO(date);
  }

  /**
   * Check if date is valid
   */
  static isValid(date: Date): boolean {
    return isValid(date);
  }

  /**
   * Format Google Calendar dates for URL
   */
  static formatGoogleCalendarDates(startDate: Date, endDate: Date, isAllDay: boolean): string {
    if (!isValid(startDate) || !isValid(endDate)) {
      return '';
    }

    if (isAllDay) {
      // All-day events use YYYYMMDD format
      const start = DateUtils.formatDateOnly(startDate);
      const end = DateUtils.formatDateOnly(endDate);
      return `${start}/${end}`;
    } else {
      // Timed events use YYYYMMDDTHHmmssZ format (UTC)
      const start = DateUtils.formatDateTime(startDate);
      const end = DateUtils.formatDateTime(endDate);
      return `${start}/${end}`;
    }
  }
} 