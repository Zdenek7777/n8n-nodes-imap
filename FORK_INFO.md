# N8N IMAP Node - Fork Informace

## Základní informace

**Fork od:** [umanamente/n8n-nodes-imap](https://github.com/umanamente/n8n-nodes-imap)  
**Můj fork:** [Zdenek7777/n8n-nodes-imap](https://github.com/Zdenek7777/n8n-nodes-imap)  
**Fork autor:** Zdeněk Bílek (bilek@fyzioklinika.cz)  
**Původní autor:** Vasily Maslyukov (auro.coding@gmail.com)

## Verzování forku

**Formát verze:** `{původní_verze}.{číslo_opravy}`

**Příklad:**
- Původní verze: `2.15.0`
- První oprava: `2.15.0.1`
- Druhá oprava: `2.15.0.2`
- Třetí oprava: `2.15.0.3`
- atd.

**Pravidlo:** Při každé opravě/úpravě zvýšit poslední číslo o 1.

## Umístění na serveru

**Server:** Dell server (CT100 - N8N LXC kontejner)  
**IP:** 192.168.33.61  
**Docker kontejner:** `n8n` (image: `n8n-custom`)

**Cesta k node v kontejneru:**
```
/home/node/.n8n/nodes/node_modules/n8n-nodes-imap
```

**Git remote na serveru:**
- Origin: `https://github.com/Zdenek7777/n8n-nodes-imap.git`
- Branch: `master`

## Aktualizace node na serveru

### Krok 1: Aktualizace z GitHubu
```bash
docker exec n8n sh -c "cd /home/node/.n8n/nodes/node_modules/n8n-nodes-imap && git pull origin master"
```

### Krok 2: Build node
```bash
docker exec n8n sh -c "cd /home/node/.n8n/nodes/node_modules/n8n-nodes-imap && npm run build"
```

### Krok 3: Restart N8N
```bash
docker restart n8n
```

### Krok 4: Ověření
```bash
# Zkontroluj logy
docker logs n8n --tail 30

# Ověř verzi
docker exec n8n cat /home/node/.n8n/nodes/node_modules/n8n-nodes-imap/package.json | grep '"version"'
```

## Workflow pro úpravy

### 1. Úprava kódu lokálně
- Uprav soubory v `AI N8N/n8n-nodes-imap/`
- Otestuj změny lokálně (pokud je to možné)

### 2. Aktualizace verze v package.json
```json
"version": "2.15.0.X",  // Zvýšit o 1
"contributors": [
  {
    "name": "Zdeněk Bílek",
    "email": "bilek@fyzioklinika.cz"
  }
]
```

### 3. Commit a push na GitHub
```bash
cd "D:\_Projekty TECH\AI N8N\n8n-nodes-imap"
git add .
git commit -m "fix: popis opravy"
git push origin master
```

### 4. Aktualizace na serveru
- Postupuj podle sekce "Aktualizace node na serveru" výše

## Historie verzí forku

| Verze | Datum | Popis změny |
|-------|-------|-------------|
| 2.15.0.3 | 2025-12-24 | Přidána podpora pro identifikaci emailů podle Message-ID (alternativa k UID) |
| 2.15.0.2 | 2025-12-23 | Oprava časové filtrace - použití INTERNALDATE místo Date hlavičky |
| 2.15.0.1 | 2025-12-03 | Parsování nestandardních formátů datumů a konverze do CR timezone |

## Důležité poznámky

- Node je nainstalovaný jako **git repozitář** v node_modules (ne jako npm balíček)
- Po každé změně je **nutné** spustit `npm run build` a restartovat N8N
- Verze se mění v `package.json` před commitem
- Všechny změny se commitnou a pushnou na GitHub před aktualizací na serveru

## Kontakt

**Fork maintainer:** Zdeněk Bílek  
**Email:** bilek@fyzioklinika.cz  
**GitHub:** https://github.com/Zdenek7777/n8n-nodes-imap

