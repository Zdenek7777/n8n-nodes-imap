/**
 * Parses email date strings, including non-standard formats.
 * 
 * Standard format: "Wed, 03 Dec 2025 06:57:11 +0100 (CET)"
 * Non-standard format: "Wed Dec 03  7:56:11 2025"
 */
export function parseEmailDate(dateStr: string | null | undefined): string | null {
    if (!dateStr) return null;
    
    // First, try standard parsing
    let parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
        return parsed.toISOString();
    }
    
    // Non-standard format: "Wed Dec 03  7:56:11 2025"
    // Pattern: DayName Month Day Time Year (without comma, different order)
    const badFormat = dateStr.match(
        /^(\w{3})\s+(\w{3})\s+(\d{1,2})\s+(\d{1,2}:\d{2}:\d{2})\s+(\d{4})$/
    );
    
    if (badFormat) {
        const [, dayName, month, day, time, year] = badFormat;
        const paddedDay = day.padStart(2, '0');
        // Pad single-digit hours: "7:56:11" -> "07:56:11"
        const paddedTime = time.replace(/^(\d):/, '0$1:');
        // Convert to standard format: "Wed, 03 Dec 2025 07:56:11 +0000"
        const normalized = `${dayName}, ${paddedDay} ${month} ${year} ${paddedTime} +0000`;
        parsed = new Date(normalized);
        if (!isNaN(parsed.getTime())) {
            return parsed.toISOString();
        }
    }
    
    // Additional non-standard formats can be added here
    // Example: "3 Dec 2025 07:56:11" (no day name)
    const noWeekday = dateStr.match(
        /^(\d{1,2})\s+(\w{3})\s+(\d{4})\s+(\d{1,2}:\d{2}:\d{2})(?:\s+([+-]\d{4}))?$/
    );
    
    if (noWeekday) {
        const [, day, month, year, time, tz] = noWeekday;
        const paddedDay = day.padStart(2, '0');
        const paddedTime = time.replace(/^(\d):/, '0$1:');
        const timezone = tz || '+0000';
        const normalized = `${paddedDay} ${month} ${year} ${paddedTime} ${timezone}`;
        parsed = new Date(normalized);
        if (!isNaN(parsed.getTime())) {
            return parsed.toISOString();
        }
    }
    
    // Return original string if all parsing attempts fail
    return dateStr;
}
