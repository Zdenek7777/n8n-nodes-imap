export function parseEmailDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  
  // Zkus standardní parsování
  let parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  
  // Nestandardní formát: "Wed Dec 03  7:56:11 2025"
  const badFormat = dateStr.match(
    /^(\w{3})\s+(\w{3})\s+(\d{1,2})\s+(\d{1,2}:\d{2}:\d{2})\s+(\d{4})$/
  );
  
  if (badFormat) {
    const [_, dayName, month, day, time, year] = badFormat;
    const paddedDay = day.padStart(2, '0');
    const paddedTime = time.replace(/^(\d):/, '0$1:');
    const normalized = `${dayName}, ${paddedDay} ${month} ${year} ${paddedTime} +0000`;
    parsed = new Date(normalized);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  
  // Vrať původní string pokud nic nefunguje
  return dateStr;
}
