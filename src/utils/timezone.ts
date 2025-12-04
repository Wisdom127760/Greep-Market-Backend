import { logger } from './logger';

/**
 * Timezone utility functions for consistent date handling across the application
 * This solves the timezone boundary issue where users see yesterday's data at 1:33 AM
 */

// Default timezone for the application (can be configured per store)
const DEFAULT_TIMEZONE = 'Europe/Nicosia'; // EEST (Eastern European Summer Time) GMT+3

export interface DateRange {
  start: Date;
  end: Date;
}

export interface TimezoneConfig {
  timezone: string;
  offset: number; // in minutes
}

/**
 * Get the configured timezone for a store or use default
 */
export function getStoreTimezone(storeId?: string): string {
  // TODO: In the future, this could be configured per store
  // For now, return the default timezone
  return DEFAULT_TIMEZONE;
}

/**
 * Get timezone offset in minutes for a given timezone
 */
export function getTimezoneOffset(timezone: string = DEFAULT_TIMEZONE): number {
  try {
    const now = new Date();
    const utc = new Date(now.getTime() + (now.getTimezoneOffset() * 60000));
    const target = new Date(utc.toLocaleString("en-US", { timeZone: timezone }));
    return (target.getTime() - utc.getTime()) / 60000;
  } catch (error) {
    logger.warn(`Failed to get timezone offset for ${timezone}, using default`, error);
    return 180; // GMT+3 as fallback
  }
}

/**
 * Convert a date string (YYYY-MM-DD) to a proper date range in the specified timezone
 * This ensures that "2025-09-28" means the full day in the store's timezone, not UTC
 */
export function parseDateRange(
  startDateStr?: string, 
  endDateStr?: string, 
  timezone: string = DEFAULT_TIMEZONE
): DateRange | null {
  if (!startDateStr || !endDateStr) {
    return null;
  }

  try {
    // Normalize inputs to YYYY-MM-DD in case ISO strings are provided
    const normalizedStart = startDateStr.length > 10 ? startDateStr.slice(0, 10) : startDateStr;
    const normalizedEnd = endDateStr.length > 10 ? endDateStr.slice(0, 10) : endDateStr;

    // Parse the date strings and create date objects in the target timezone
    const startDate = parseDateInTimezone(normalizedStart, timezone, 'start');
    const endDate = parseDateInTimezone(normalizedEnd, timezone, 'end');
    
    logger.info(`Parsed date range for ${timezone}:`, {
      startDateStr,
      endDateStr,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      startLocal: startDate.toLocaleString(),
      endLocal: endDate.toLocaleString()
    });

    return { start: startDate, end: endDate };
  } catch (error) {
    logger.error('Error parsing date range:', error);
    return null;
  }
}

/**
 * Parse a single date string in the specified timezone
 */
function parseDateInTimezone(
  dateStr: string, 
  timezone: string, 
  boundary: 'start' | 'end'
): Date {
  try {
    // If ISO string provided, trim to date portion
    const safeDateStr = dateStr.length > 10 ? dateStr.slice(0, 10) : dateStr;
    // Parse the date string (YYYY-MM-DD format)
    const [year, month, day] = safeDateStr.split('-').map(Number);
    
    // Validate the date components
    if (isNaN(year) || isNaN(month) || isNaN(day) || 
        year < 1900 || year > 2100 || 
        month < 1 || month > 12 || 
        day < 1 || day > 31) {
      throw new Error(`Invalid date components: ${year}-${month}-${day}`);
    }
    
    if (boundary === 'start') {
      // Start of day in the target timezone
      const date = new Date(year, month - 1, day, 0, 0, 0, 0);
      if (isNaN(date.getTime())) {
        throw new Error(`Invalid date: ${year}-${month}-${day}`);
      }
      return date;
    } else {
      // End of day in the target timezone
      const date = new Date(year, month - 1, day, 23, 59, 59, 999);
      if (isNaN(date.getTime())) {
        throw new Error(`Invalid date: ${year}-${month}-${day}`);
      }
      return date;
    }
  } catch (error) {
    logger.error(`Error parsing date in timezone: ${error instanceof Error ? error.message : String(error)}`, {
      dateStr,
      timezone,
      boundary
    });
    throw error;
  }
}

/**
 * Create a date range for "today" in the specified timezone
 */
export function getTodayRange(timezone: string = DEFAULT_TIMEZONE): DateRange {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  return {
    start: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0),
    end: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999)
  };
}

/**
 * Create a date range for "yesterday" in the specified timezone
 */
export function getYesterdayRange(timezone: string = DEFAULT_TIMEZONE): DateRange {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  
  return {
    start: new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0, 0),
    end: new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999)
  };
}

/**
 * Create a date range for "this month" in the specified timezone
 */
export function getThisMonthRange(timezone: string = DEFAULT_TIMEZONE): DateRange {
  const now = new Date();
  
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  };
}

/**
 * Create a date range for a specific month and year in the specified timezone
 * @param month - Month number (1-12, where 1 = January)
 * @param year - Year (e.g., 2025)
 * @param timezone - Timezone string (default: Europe/Istanbul)
 */
export function getMonthYearRange(month: number, year: number, timezone: string = DEFAULT_TIMEZONE): DateRange {
  // Month is 0-indexed in JavaScript Date, so subtract 1
  const monthIndex = month - 1;
  
  // Validate month and year
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month: ${month}. Month must be between 1 and 12.`);
  }
  
  if (year < 1900 || year > 2100) {
    throw new Error(`Invalid year: ${year}. Year must be between 1900 and 2100.`);
  }
  
  // Get first day of the month at 00:00:00
  const start = new Date(year, monthIndex, 1, 0, 0, 0, 0);
  
  // Get last day of the month at 23:59:59.999
  // Using monthIndex + 1 and day 0 gives us the last day of the current month
  const end = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
  
  logger.info(`Created month/year range for ${timezone}:`, {
    month,
    year,
    start: start.toISOString(),
    end: end.toISOString(),
    startLocal: start.toLocaleString('en-US', { timeZone: timezone }),
    endLocal: end.toLocaleString('en-US', { timeZone: timezone })
  });
  
  return { start, end };
}

/**
 * Create a date range for the last N days in the specified timezone
 */
export function getLastNDaysRange(days: number, timezone: string = DEFAULT_TIMEZONE): DateRange {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  
  return {
    start: new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0),
    end: new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999)
  };
}

/**
 * Convert a date range to MongoDB query format
 */
export function dateRangeToMongoQuery(dateRange: DateRange): { $gte: Date; $lte: Date } {
  return {
    $gte: dateRange.start,
    $lte: dateRange.end
  };
}

/**
 * Validate and normalize date strings
 */
export function validateDateString(dateStr: string): boolean {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) {
    return false;
  }
  
  const date = new Date(dateStr + 'T00:00:00');
  return !isNaN(date.getTime());
}

/**
 * Get the current date in the specified timezone as YYYY-MM-DD string
 */
export function getCurrentDateString(timezone: string = DEFAULT_TIMEZONE): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

/**
 * Format a date for display in the specified timezone
 */
export function formatDateForTimezone(date: Date, timezone: string = DEFAULT_TIMEZONE): string {
  try {
    return date.toLocaleDateString('en-CA', { timeZone: timezone }); // en-CA gives YYYY-MM-DD format
  } catch (error) {
    logger.warn(`Failed to format date for timezone ${timezone}, using local format`, error);
    return date.toISOString().split('T')[0];
  }
}

/**
 * Check if two dates are on the same day in the specified timezone
 */
export function isSameDay(date1: Date, date2: Date, timezone: string = DEFAULT_TIMEZONE): boolean {
  try {
    const d1 = new Date(date1.toLocaleDateString('en-CA', { timeZone: timezone }));
    const d2 = new Date(date2.toLocaleDateString('en-CA', { timeZone: timezone }));
    return d1.getTime() === d2.getTime();
  } catch (error) {
    logger.warn(`Failed to compare dates for timezone ${timezone}, using local comparison`, error);
    return date1.toDateString() === date2.toDateString();
  }
}

/**
 * Debug helper to log timezone information
 */
export function debugTimezoneInfo(dateStr?: string, timezone: string = DEFAULT_TIMEZONE): void {
  const now = new Date();
  const offset = getTimezoneOffset(timezone);
  
  logger.info('Timezone Debug Info:', {
    timezone,
    offsetMinutes: offset,
    offsetHours: offset / 60,
    currentUTC: now.toISOString(),
    currentLocal: now.toLocaleString(),
    currentInTimezone: now.toLocaleString('en-US', { timeZone: timezone }),
    ...(dateStr && {
      inputDateStr: dateStr,
      parsedInUTC: new Date(dateStr).toISOString(),
      parsedInLocal: new Date(dateStr).toLocaleString(),
      parsedInTimezone: new Date(dateStr).toLocaleString('en-US', { timeZone: timezone })
    })
  });
}
