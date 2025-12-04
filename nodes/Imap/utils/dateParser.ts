/**
 * Parses email date strings, including non-standard formats.
 * 
 * Supported formats:
 * - Standard RFC 2822: "Wed, 03 Dec 2025 06:57:11 +0100 (CET)"
 * - Non-standard: "Wed Dec 03  7:56:11 2025"
 * - Without weekday: "3 Dec 2025 07:56:11"
 * - ISO-like: "2025-12-03T07:56:11"
 * - Unix timestamp (as string): "1701592571000"
 * 
 * This function is designed to be extensible - new date format parsers
 * can be easily added to the parsers array.
 */

/**
 * Type for date format parser functions
 */
type DateFormatParser = (dateStr: string) => string | null;

/**
 * Pads single-digit hours in time string: "7:56:11" -> "07:56:11"
 */
function padTime(time: string): string {
    return time.replace(/^(\d):/, '0$1:');
}

/**
 * Pads single-digit day: "3" -> "03"
 */
function padDay(day: string): string {
    return day.padStart(2, '0');
}

/**
 * Array of date format parsers, ordered by priority.
 * Each parser returns ISO string if successful, null otherwise.
 */
const dateParsers: DateFormatParser[] = [
    // Parser 1: Standard RFC 2822 format (try first as it's most common)
    (dateStr: string): string | null => {
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
            return parsed.toISOString();
        }
        return null;
    },

    // Parser 2: "Wed Dec 03  7:56:11 2025" (day name, month, day, time, year - no comma)
    (dateStr: string): string | null => {
        const match = dateStr.match(
            /^(\w{3})\s+(\w{3})\s+(\d{1,2})\s+(\d{1,2}:\d{2}:\d{2})\s+(\d{4})$/
        );
        
        if (match) {
            const [, dayName, month, day, time, year] = match;
            const paddedDay = padDay(day);
            const paddedTime = padTime(time);
            // Convert to standard format: "Wed, 03 Dec 2025 07:56:11 +0000"
            const normalized = `${dayName}, ${paddedDay} ${month} ${year} ${paddedTime} +0000`;
            const parsed = new Date(normalized);
            if (!isNaN(parsed.getTime())) {
                return parsed.toISOString();
            }
        }
        return null;
    },

    // Parser 3: "3 Dec 2025 07:56:11" or "3 Dec 2025 07:56:11 +0100" (no weekday)
    (dateStr: string): string | null => {
        const match = dateStr.match(
            /^(\d{1,2})\s+(\w{3})\s+(\d{4})\s+(\d{1,2}:\d{2}:\d{2})(?:\s+([+-]\d{4}))?$/
        );
        
        if (match) {
            const [, day, month, year, time, tz] = match;
            const paddedDay = padDay(day);
            const paddedTime = padTime(time);
            const timezone = tz || '+0000';
            const normalized = `${paddedDay} ${month} ${year} ${paddedTime} ${timezone}`;
            const parsed = new Date(normalized);
            if (!isNaN(parsed.getTime())) {
                return parsed.toISOString();
            }
        }
        return null;
    },

    // Parser 4: ISO-like format without timezone: "2025-12-03T07:56:11" or "2025-12-03 07:56:11"
    (dateStr: string): string | null => {
        const match = dateStr.match(
            /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T\s](\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-]\d{2}:?\d{2}))?$/
        );
        
        if (match) {
            const [, year, month, day, hour, minute, second, millis, tz] = match;
            const paddedMonth = padDay(month);
            const paddedDay = padDay(day);
            const paddedHour = padDay(hour);
            const millisPart = millis ? `.${millis.padEnd(3, '0').substring(0, 3)}` : '';
            const tzPart = tz ? (tz.includes(':') ? tz : `${tz.substring(0, 3)}:${tz.substring(3)}`) : 'Z';
            const normalized = `${year}-${paddedMonth}-${paddedDay}T${paddedHour}:${minute}:${second}${millisPart}${tzPart}`;
            const parsed = new Date(normalized);
            if (!isNaN(parsed.getTime())) {
                return parsed.toISOString();
            }
        }
        return null;
    },

    // Parser 5: Unix timestamp (as string): "1701592571000" or "1701592571"
    (dateStr: string): string | null => {
        // Check if it's a numeric string (potentially a timestamp)
        if (/^\d+$/.test(dateStr.trim())) {
            const timestamp = parseInt(dateStr.trim(), 10);
            // Check if it's a reasonable timestamp (between 1970 and 2100)
            if (timestamp > 0 && timestamp < 4102444800000) {
                // If it's in seconds (less than 13 digits), convert to milliseconds
                const msTimestamp = timestamp < 10000000000 ? timestamp * 1000 : timestamp;
                const parsed = new Date(msTimestamp);
                if (!isNaN(parsed.getTime())) {
                    return parsed.toISOString();
                }
            }
        }
        return null;
    },

    // Parser 6: "Dec 03 2025 07:56:11" (month name first, no weekday)
    (dateStr: string): string | null => {
        const match = dateStr.match(
            /^(\w{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}:\d{2}:\d{2})(?:\s+([+-]\d{4}))?$/
        );
        
        if (match) {
            const [, month, day, year, time, tz] = match;
            const paddedDay = padDay(day);
            const paddedTime = padTime(time);
            const timezone = tz || '+0000';
            const normalized = `${paddedDay} ${month} ${year} ${paddedTime} ${timezone}`;
            const parsed = new Date(normalized);
            if (!isNaN(parsed.getTime())) {
                return parsed.toISOString();
            }
        }
        return null;
    },
];

/**
 * Main function to parse email date strings.
 * Tries all parsers in order and returns the first successful result.
 * If all parsers fail, returns the original string.
 * 
 * @param dateStr - The date string to parse (can be null or undefined)
 * @returns ISO 8601 formatted date string, or original string if parsing fails, or null if input is null/undefined
 */
export function parseEmailDate(dateStr: string | null | undefined): string | null {
    if (!dateStr) return null;
    
    // Trim whitespace
    const trimmed = dateStr.trim();
    if (!trimmed) return null;
    
    // Try each parser in order
    for (const parser of dateParsers) {
        try {
            const result = parser(trimmed);
            if (result) {
                return result;
            }
        } catch (error) {
            // If a parser throws an error, continue to the next one
            // This allows parsers to be more lenient without breaking the whole function
            continue;
        }
    }
    
    // If all parsers failed, return the original string
    // This preserves the original data for debugging purposes
    return dateStr;
}

/**
 * Converts an ISO date string to RFC 2822 format in Czech Republic timezone (+0100 CET or +0200 CEST).
 * 
 * @param isoDateStr - ISO 8601 formatted date string (e.g., "2025-12-03T13:42:50.000Z")
 * @returns RFC 2822 formatted date string in CR timezone (e.g., "Wed, 03 Dec 2025 14:42:50 +0100 (CET)")
 */
export function convertToCRTimezone(isoDateStr: string | null | undefined): string | null {
    if (!isoDateStr) return null;
    
    try {
        const date = new Date(isoDateStr);
        if (isNaN(date.getTime())) {
            return null;
        }
        
        // Format date in CR timezone (Europe/Prague)
        const crFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Europe/Prague',
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        });
        
        // Get CR timezone parts
        const crParts = crFormatter.formatToParts(date);
        const weekday = crParts.find(p => p.type === 'weekday')?.value || 'Mon';
        const day = crParts.find(p => p.type === 'day')?.value || '01';
        const month = crParts.find(p => p.type === 'month')?.value || 'Jan';
        const year = crParts.find(p => p.type === 'year')?.value || '2025';
        const hour = crParts.find(p => p.type === 'hour')?.value || '00';
        const minute = crParts.find(p => p.type === 'minute')?.value || '00';
        const second = crParts.find(p => p.type === 'second')?.value || '00';
        
        // Get UTC time for the same moment to calculate offset
        const utcFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'UTC',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
        
        const utcParts = utcFormatter.formatToParts(date);
        const utcHour = parseInt(utcParts.find(p => p.type === 'hour')?.value || '0');
        const utcMinute = parseInt(utcParts.find(p => p.type === 'minute')?.value || '0');
        const utcDay = parseInt(utcParts.find(p => p.type === 'day')?.value || '1');
        
        const crHour = parseInt(hour);
        const crMinute = parseInt(minute);
        const crDay = parseInt(day);
        
        // Calculate offset: difference between CR time and UTC time
        let offsetMinutes = (crHour * 60 + crMinute) - (utcHour * 60 + utcMinute);
        
        // Adjust for day difference
        if (crDay !== utcDay) {
            if (crDay > utcDay) {
                offsetMinutes += 1440; // CR is ahead by a day
            } else {
                offsetMinutes -= 1440; // CR is behind by a day
            }
        }
        
        // Normalize to -720 to +720 range (should be +60 or +120 for CR)
        while (offsetMinutes > 720) offsetMinutes -= 1440;
        while (offsetMinutes < -720) offsetMinutes += 1440;
        
        const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
        const offsetMins = Math.abs(offsetMinutes) % 60;
        const offsetSign = offsetMinutes >= 0 ? '+' : '-';
        const offsetStr = `${offsetSign}${String(offsetHours).padStart(2, '0')}${String(offsetMins).padStart(2, '0')}`;
        
        // Determine if it's CET or CEST (CET = +0100, CEST = +0200)
        const isDST = offsetMinutes === 120; // CEST is UTC+2
        const tzName = isDST ? 'CEST' : 'CET';
        
        return `${weekday}, ${day} ${month} ${year} ${hour}:${minute}:${second} ${offsetStr} (${tzName})`;
    } catch (error) {
        return null;
    }
}