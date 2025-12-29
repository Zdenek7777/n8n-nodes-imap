# Oprava časové filtrace v n8n-nodes-imap

## Problém
Emaily přeposlané přes profi.seznam.cz měly Date hlavičku s původním časem odeslání, ale skutečný čas doručení (INTERNALDATE) byl pozdější. Client-side filtrace používala Date hlavičku místo INTERNALDATE, což vedlo k vyřazování emailů.

## Řešení
Upravena client-side filtrace v `EmailGetList.ts` - nyní používá `internalDate` (INTERNALDATE) jako prioritu 1.

## Postup instalace a testování

### KROK 1: Ověření změn ✅
Změny jsou již provedeny v souboru:
- `nodes/Imap/operations/email/functions/EmailGetList.ts` (řádky 248-307)

### KROK 2: Sestavení node
Pokud máš nainstalované závislosti, sestav node:

```bash
cd "D:\_Projekty TECH\AI N8N\n8n-nodes-imap"
npm install
npm run build
```

**POZNÁMKA:** Pokud nemáš nainstalované závislosti nebo nechceš sestavovat, můžeš použít TypeScript přímo v n8n (pokud máš n8n s podporou TypeScript).

### KROK 3: Aktivace debug logů
Pro testování aktivuj debug logy v n8n:

1. V n8n nastav environment proměnné:
   - `N8N_NODES_DEBUG_ENABLED=true`
   - `N8N_LOG_LEVEL=debug`

2. Nebo v workflow přidej na začátek Set node s:
   ```json
   {
     "N8N_NODES_DEBUG_ENABLED": "true",
     "N8N_LOG_LEVEL": "debug"
   }
   ```

### KROK 4: Testování
1. Spusť workflow s IMAP node
2. V logách hledej zprávy typu:
   - `Email X: Passed filter (date: ... [internalDate])`
   - `Email X: Using envelope.date as fallback (internalDate not available)`
   - `Email X: Using Date header as fallback (internalDate and envelope.date not available)`

### KROK 5: Ověření opravy
Ověř, že:
- Emaily s rozdílem mezi Date hlavičkou a skutečným doručením projdou filtrací
- V logách vidíš `[internalDate]` jako zdroj data (ne `[Date header]`)
- Žádné emaily nejsou vyřazeny kvůli starší Date hlavičce

## Co bylo změněno

### Před opravou:
- Client-side filtrace používala `email.envelope.date` nebo Date hlavičku
- Date hlavička = původní čas odeslání (může být starší než skutečné doručení)

### Po opravě:
- Client-side filtrace používá `email.internalDate` (INTERNALDATE) jako prioritu 1
- INTERNALDATE = skutečný čas doručení na server
- Fallback na `envelope.date` a Date hlavičku pouze pokud `internalDate` není dostupné

## Technické detaily

**Soubor:** `nodes/Imap/operations/email/functions/EmailGetList.ts`
**Řádky:** 248-307
**Změna:** Priorita 1 nyní používá `email.internalDate` místo `email.envelope.date`

## Kontakt
Pokud máš problémy s opravou, zkontroluj:
1. Zda jsou změny správně uloženy v souboru
2. Zda je node správně sestaven (pokud používáš build)
3. Zda jsou aktivní debug logy pro ověření



