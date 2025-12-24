# N8N IMAP Node - Modifikace pro parsování datumů a CR timezone

Tento dokument popisuje modifikace provedené v N8N IMAP node pro správné parsování nestandardních formátů datumů a konverzi do českého časového pásma.

## Přehled modifikací

IMAP node byl upraven, aby:
1. **Parsoval nestandardní formáty datumů** z emailových hlaviček
2. **Konvertoval datumy do českého časového pásma** (CET/CEST)
3. **Ukládal původní formát data** pro referenci
4. **Odstraňoval nepotřebná pole** z výstupu (headers, buffer)

---

## Problém, který řešíme

### Původní problém

IMAP node při operaci "Get Many" vracel prázdné pole `date` u emailů, které měly nestandardní formát datumu v hlavičce.

**Fungující formát (RFC 2822):**
```
Date: Wed, 03 Dec 2025 06:57:11 +0100 (CET)
```

**Nefungující formát (nestandardní):**
```
Date: Wed Dec 03  7:56:11 2025
```

### Požadavky na řešení

1. Parsovat nestandardní formáty datumů
2. Konvertovat datumy do českého časového pásma (+0100 CET nebo +0200 CEST)
3. Ukládat původní formát data pro referenci
4. Správné pořadí polí v `envelope` objektu
5. Odstranit `headers` a `buffer` z výstupu

---

## Implementované řešení

### 1. Parsování nestandardních formátů datumů

**Soubor:** `nodes/Imap/utils/dateParser.ts`

Funkce `parseEmailDate()` podporuje následující formáty:

1. **Standardní RFC 2822:**
   - `"Wed, 03 Dec 2025 06:57:11 +0100 (CET)"`
   - `"Wed, 03 Dec 2025 06:57:11 +0100"`

2. **Nestandardní formát bez čárky:**
   - `"Wed Dec 03  7:56:11 2025"`

3. **Bez názvu dne:**
   - `"3 Dec 2025 07:56:11"`
   - `"3 Dec 2025 07:56:11 +0100"`

4. **ISO-like formát:**
   - `"2025-12-03T07:56:11"`
   - `"2025-12-03 07:56:11"`

5. **Unix timestamp:**
   - `"1701592571000"` (milisekundy)
   - `"1701592571"` (sekundy)

6. **Měsíc na začátku:**
   - `"Dec 03 2025 07:56:11"`

**Jak to funguje:**
- Funkce obsahuje pole parserů (`dateParsers`), které se zkouší v pořadí
- Každý parser vrací ISO 8601 formátovaný string, pokud je úspěšný
- Pokud všechny parsery selžou, vrátí se původní string

**Příklad použití:**
```typescript
import { parseEmailDate } from '../../../utils/dateParser';

const originalDate = "Wed Dec 03  7:56:11 2025";
const parsedDate = parseEmailDate(originalDate);
// Výsledek: "2025-12-03T07:56:11.000Z"
```

### 2. Konverze do českého časového pásma

**Soubor:** `nodes/Imap/utils/dateParser.ts`

Funkce `convertToCRTimezone()` konvertuje ISO datum do RFC 2822 formátu v českém časovém pásmu.

**Funkce:**
- Přijímá ISO 8601 formátovaný string (např. `"2025-12-03T13:42:50.000Z"`)
- Konvertuje do časového pásma `Europe/Prague`
- Automaticky určuje, zda je CET (UTC+1) nebo CEST (UTC+2)
- Vrací RFC 2822 formátovaný string

**Výstupní formát:**
```
Wed, 03 Dec 2025 14:42:50 +0100 (CET)
```
nebo
```
Wed, 03 Dec 2025 15:42:50 +0200 (CEST)
```

**Jak to funguje:**
1. Vytvoří `Date` objekt z ISO stringu
2. Použije `Intl.DateTimeFormat` s `timeZone: 'Europe/Prague'` pro formátování
3. Vypočítá timezone offset porovnáním UTC a CR času
4. Určí, zda je DST (Daylight Saving Time) aktivní
5. Vrátí formátovaný string s příslušným offsetem a názvem timezone

**Příklad použití:**
```typescript
import { convertToCRTimezone } from '../../../utils/dateParser';

const isoDate = "2025-12-03T13:42:50.000Z";
const crDate = convertToCRTimezone(isoDate);
// Výsledek: "Wed, 03 Dec 2025 14:42:50 +0100 (CET)"
```

### 3. Integrace do EmailGetList

**Soubor:** `nodes/Imap/operations/email/functions/EmailGetList.ts`

#### 3.1. Extrakce původního data

Kód nejprve extrahuje původní datum z emailových hlaviček **před** JSON serializací, aby zachoval přesný formát:

```typescript
// First, try to get original date from headers (before JSON serialization converts it)
if (email.headers) {
  const headersString = email.headers.toString();
  const dateHeaderMatch = headersString.match(/^Date:\s*([^\r\n]+)/im);
  if (dateHeaderMatch && dateHeaderMatch[1]) {
    originalDate = dateHeaderMatch[1].trim();
  }
}
```

#### 3.2. Parsování a konverze

```typescript
// Store original date exactly as received (before any parsing)
const dateOriginal = originalDate;

// Try to parse the date to ISO format
const parsedDateISO = parseEmailDate(originalDate);

// Convert parsed ISO date to CR timezone format
let dateInCRTimezone: string | null = null;
if (parsedDateISO && parsedDateISO.trim() && parsedDateISO !== originalDate) {
  dateInCRTimezone = convertToCRTimezone(parsedDateISO);
}
```

#### 3.3. Rekonstrukce envelope objektu

Kód rekonstruuje `envelope` objekt s **správným pořadím polí**:

```typescript
// Rebuild envelope with correct order: date first, then dateOriginal, then other fields
item_json.envelope = {
  date: envelopeDate,           // CR timezone format
  dateOriginal: envelopeDateOriginal,  // Original format from email
  ...otherEnvelopeFields,       // Other envelope fields (subject, from, to, etc.)
};
```

#### 3.4. Odstranění nepotřebných polí

Před přidáním do výstupu se odstraní `headers` a `buffer`:

```typescript
// Remove headers and buffer from output
if (item_json.headers !== undefined) {
  delete item_json.headers;
}
if (item_json.buffer !== undefined) {
  delete item_json.buffer;
}
```

---

## Výstupní struktura

### Před modifikací

```json
{
  "uid": 14,
  "envelope": {
    "date": "2025-12-03T13:42:50.000Z",
    "subject": "...",
    "from": [...],
    "to": [...]
  },
  "headers": {...},
  "buffer": {...}
}
```

### Po modifikaci

```json
{
  "uid": 14,
  "date": "Wed, 03 Dec 2025 14:42:50 +0100 (CET)",
  "envelope": {
    "date": "Wed, 03 Dec 2025 14:42:50 +0100 (CET)",
    "dateOriginal": "Wed Dec 03  7:56:11 2025",
    "subject": "...",
    "from": [...],
    "to": [...],
    "sender": [...],
    "replyTo": [...],
    "messageId": "..."
  }
}
```

**Pole:**
- `date` (top-level) - Datum v CR timezone formátu
- `envelope.date` - Parsované a konvertované datum v CR timezone formátu
- `envelope.dateOriginal` - Původní formát data z emailu (přesně tak, jak přišlo)
- Ostatní pole v `envelope` - Standardní IMAP envelope data

---

## Rozšiřitelnost

### Přidání nového formátu data

Pokud narazíš na další nestandardní formát data, můžeš ho přidat do pole `dateParsers` v `dateParser.ts`:

```typescript
const dateParsers: DateFormatParser[] = [
  // ... existující parsery ...
  
  // Nový parser pro specifický formát
  (dateStr: string): string | null => {
    const match = dateStr.match(/^tvoje-regex-pattern$/);
    if (match) {
      // Normalizuj do standardního formátu
      const normalized = "...";
      const parsed = new Date(normalized);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
    return null;
  },
];
```

**Důležité:**
- Parsery se zkouší v pořadí, takže nejčastější formáty by měly být první
- Parser musí vrátit `null`, pokud formát nerozpozná
- Parser může vyhodit výjimku - bude zachycena a pokračuje se dalším parserem

---

## Testování

### Testování parsování

1. Vytvoř test email s nestandardním formátem data
2. Použij IMAP node operaci "Get Many"
3. Ověř, že:
   - `envelope.date` obsahuje parsované datum v CR timezone
   - `envelope.dateOriginal` obsahuje původní formát
   - `date` (top-level) obsahuje CR timezone formát

### Testování timezone konverze

1. Otestuj s emailem v různých časových pásmech
2. Ověř, že datum je správně konvertováno do CR timezone
3. Ověř, že DST (letní čas) je správně detekován

---

## Technické detaily

### Použité technologie

- **TypeScript** - Typovaný JavaScript
- **Intl.DateTimeFormat** - Pro timezone konverzi
- **RegExp** - Pro parsování nestandardních formátů
- **Date API** - Pro manipulaci s datumy

### Závislosti

- Žádné nové externí závislosti
- Pouze standardní JavaScript/TypeScript API

### Výkon

- Parsování je rychlé - zkouší se pouze několik regex matchů
- Timezone konverze používá nativní Intl API (optimalizované)
- Žádné blokující operace

---

## Historie změn

- **2025-12-03**: Implementace parsování nestandardních formátů datumů
- **2025-12-03**: Přidání konverze do CR timezone
- **2025-12-03**: Oprava pořadí polí v envelope objektu
- **2025-12-03**: Odstranění headers a buffer z výstupu

---

## Kontakt

**Autor:** Zdenek Bilek  
**Email:** bilek@fyzioklinika.cz  
**GitHub:** https://github.com/Zdenek7777/n8n-nodes-imap

---

**Poslední aktualizace:** 2025-12-03

