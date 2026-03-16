# API Standard Requirements

Server di default: `http://localhost:4000`

## Tabella standard_requirements

```sql
CREATE TABLE standard_requirements (
  id SERIAL PRIMARY KEY,
  standard_onsite TEXT NOT NULL,
  standard_cologno TEXT NOT NULL,
  site TEXT NOT NULL,              -- STADIO / COLOGNO
  area_produzione TEXT NOT NULL,  -- GALLERY01, PCR01, BOOTH, FLYPACK, etc.
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 1,
  notes TEXT
);
```

### Esempio di riga

| standard_onsite | standard_cologno | site   | area_produzione | role_code | quantity |
|----------------|------------------|--------|-----------------|-----------|----------|
| NO ONSITE      | GALLERY01        | COLOGNO| GALLERY01       | REGISTA   | 1        |

---

## Endpoint

### Leggere requirements

```bash
# Con filtri standardOnsite, standardCologno (obbligatori per filtro designazioni)
# site e areaProduzione opzionali
curl "http://localhost:4000/api/standard-requirements?standardOnsite=DAZN3&standardCologno=GALLERY01&areaProduzione=VIRTUAL%20STUDIO"
```

Risposta:
```json
{
  "items": [
    {
      "id": 1,
      "standardOnsite": "NO ONSITE",
      "standardCologno": "GALLERY01",
      "site": "COLOGNO",
      "areaProduzione": "GALLERY01",
      "roleId": 37,
      "roleCode": "REGISTA",
      "roleName": "Regista",
      "roleLocation": "COLOGNO",
      "quantity": 1,
      "notes": null
    }
  ]
}
```

### Generare assignments da standard per un evento

```bash
curl -X POST http://localhost:4000/api/events/1/generate-assignments-from-standard
```

Comportamento:
- Carica l'evento e verifica che abbia `standard_onsite`, `standard_cologno` e `location` (site) valorizzati
- Cerca i `standard_requirements` per quella combinazione
- Crea `quantity` slot vuoti in `assignments` per ogni requirement
- Ritorna la lista completa degli assignments dell'evento

Se non ci sono requirements per la combinazione, ritorna `200` con `items: []`.
