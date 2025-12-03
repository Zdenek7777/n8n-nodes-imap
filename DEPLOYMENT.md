# Nasazování změn n8n-nodes-imap

Tento dokument popisuje postup pro nasazování změn z lokálního repozitáře na GitHub a následně na server DELL.

## Předpoklady

- Lokální repozitář: `D:\_Projekty\AI RAG\n8n-nodes-imap`
- GitHub repozitář: `https://github.com/Zdenek7777/n8n-nodes-imap.git`
- Server: DELL (LXC 100, IP: 192.168.33.61)
- N8N běží v Docker kontejneru: `n8n`

---

## Krok 1: Commit a Push změn na GitHub

### 1.1. Zkontroluj stav repozitáře

```bash
cd "D:\_Projekty\AI RAG\n8n-nodes-imap"
git status
```

### 1.2. Přidej změněné soubory

```bash
git add <změněné_soubory>
# Příklady:
git add nodes/Imap/operations/email/functions/EmailGetList.ts
git add nodes/Imap/utils/dateParser.ts
```

### 1.3. Vytvoř commit

```bash
git commit -m "fix: popis změny" -m "- Detail 1" -m "- Detail 2"
```

**Příklad:**
```bash
git commit -m "fix: always fetch Date header and display date as-is" -m "- Always fetches Date header even if headers are not in includeParts" -m "- Displays date in original format in top-level date field"
```

### 1.4. Pushni změny na GitHub

```bash
git push
```

**Ověření:**
- Zkontroluj na GitHubu, že změny jsou pushnuté
- URL: https://github.com/Zdenek7777/n8n-nodes-imap

---

## Krok 2: Nasazení na server DELL

### 2.1. Připoj se na server

```bash
ssh root@192.168.33.61
# Nebo přes Proxmox konzoli
```

### 2.2. Aktualizuj repozitář v Docker kontejneru

```bash
docker exec n8n sh -c "cd /home/node/.n8n/nodes/node_modules/n8n-nodes-imap && git pull"
```

**Očekávaný výstup:**
```
Updating <commit-hash>..<new-commit-hash>
Fast-forward
 ...
```

### 2.3. Zbuildu balíček

```bash
docker exec n8n sh -c "cd /home/node/.n8n/nodes/node_modules/n8n-nodes-imap && npm run build"
```

**Očekávaný výstup:**
```
> n8n-nodes-imap@2.15.0 build
> tsc && gulp build:icons

[timestamp] Using gulpfile ...
[timestamp] Starting 'build:icons'...
[timestamp] Finished 'build:icons' after XX ms
```

### 2.4. Restartuj N8N

```bash
docker restart n8n
```

**Ověření:**
```bash
docker logs n8n --tail 50 | grep -i "community\|imap"
```

Mělo by se zobrazit:
```
Community package installed: n8n-nodes-imap
```

---

## Krok 3: Ověření nasazení

### 3.1. Otevři N8N UI

```
https://n8n.fyziosys.cz
```

### 3.2. Otestuj node

1. Vytvoř nový workflow nebo otevři existující
2. Přidej IMAP node (community node)
3. Nastav operaci: Email → Get Many
4. Spusť test

### 3.3. Zkontroluj výstup

Výstup by měl obsahovat:
- `date` - pole na top-level s datem (v původním nebo ISO formátu)
- `envelope.date` - parsované datum (ISO formát)
- `envelope.dateOriginal` - původní string z emailu

---

## Kompletní příkaz pro rychlé nasazení

Pokud máš změny commitnuté a pushnuté na GitHub, můžeš použít tento jednoduchý příkaz:

```bash
# Na serveru (LXC 100)
docker exec n8n sh -c "cd /home/node/.n8n/nodes/node_modules/n8n-nodes-imap && git pull && npm run build" && docker restart n8n
```

---

## Řešení problémů

### Problém: `git pull` selže s chybou "not a git repository"

**Řešení:**
```bash
# Odinstaluj balíček
docker exec n8n sh -c "cd /home/node/.n8n/nodes && npm uninstall n8n-nodes-imap"

# Smaž node_modules složku
docker exec n8n sh -c "rm -rf /home/node/.n8n/nodes/node_modules/n8n-nodes-imap"

# Naklonuj repozitář
docker exec n8n sh -c "cd /home/node/.n8n/nodes/node_modules && git clone https://github.com/Zdenek7777/n8n-nodes-imap.git"

# Nainstaluj závislosti a zbuildu
docker exec n8n sh -c "cd /home/node/.n8n/nodes/node_modules/n8n-nodes-imap && npm install --include=dev && npm run build"

# Restartuj N8N
docker restart n8n
```

### Problém: `npm run build` selže s chybou "tsc: not found"

**Řešení:**
```bash
# Nainstaluj dev dependencies
docker exec n8n sh -c "cd /home/node/.n8n/nodes/node_modules/n8n-nodes-imap && npm install --include=dev"

# Zkus znovu build
docker exec n8n sh -c "cd /home/node/.n8n/nodes/node_modules/n8n-nodes-imap && npm run build"
```

### Problém: Node není viditelný v N8N UI

**Řešení:**
1. Zkontroluj logy: `docker logs n8n --tail 100 | grep -i "community\|imap"`
2. Zkontroluj, zda existuje dist složka:
   ```bash
   docker exec n8n ls -la /home/node/.n8n/nodes/node_modules/n8n-nodes-imap/dist/
   ```
3. Pokud dist složka neexistuje, zbuildu znovu:
   ```bash
   docker exec n8n sh -c "cd /home/node/.n8n/nodes/node_modules/n8n-nodes-imap && npm run build"
   ```
4. Restartuj N8N: `docker restart n8n`

---

## Důležité poznámky

1. **Vždy commitni změny před pushnutím** - zkontroluj `git status` před commitnutím
2. **Používej smysluplné commit messages** - pomůže to při sledování změn
3. **Ověř build před restartem** - zkontroluj, že `npm run build` proběhl úspěšně
4. **Zkontroluj logy po restartu** - ověř, že N8N načetl node správně
5. **Testuj změny v N8N UI** - vždy otestuj node po nasazení

---

## Historie změn

- **2025-12-03**: Vytvoření dokumentace s funkčním postupem nasazení
- **2025-12-03**: Přidání řešení problémů a ověřovacích kroků

---

**Poslední aktualizace:** 2025-12-03  
**Autor:** Zdenek Bilek  
**Email:** bilek@fyzioklinika.cz

