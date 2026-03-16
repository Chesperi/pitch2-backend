# Eventi e Designazioni

Server di default: `http://localhost:4000`

## Campi principali di events

| Campo SQL        | Campo TS          | Descrizione                                      |
|------------------|-------------------|--------------------------------------------------|
| standard_onsite  | standardOnsite    | Es. NO ONSITE, DAZN3                             |
| standard_cologno | standardCologno   | Es. GALLERY01, PCR01, FLYPACK                     |
| location         | areaProduzione    | Area di lavoro (GALLERY01, PCR01, BOOTH, ecc.)   |
| status           | status            | TBD, OK, CONFIRMED, ecc.                         |
| assignments_status | assignmentsStatus | DRAFT, READY_TO_SEND, SENT                      |

## Regola: evento designabile

Un evento è **designabile** (pronto per generare slot) se:

- `standard_onsite` non vuoto
- `standard_cologno` non vuoto
- `status` IN ('OK', 'CONFIRMED')

## standard_requirements

La tabella `standard_requirements` definisce quanti slot per ruolo servono per ogni combinazione standard_onsite + standard_cologno (+ site per distinguere STADIO/COLOGNO).

- **site**: sede (STADIO | COLOGNO)
- **area_produzione**: area di lavoro (GALLERY01, PCR01, ecc.)
- **role_id**, **quantity**, **notes**

## Generazione automatica degli assignments

La funzione `ensureAssignmentsForEvent(pool, eventId)`:

1. Carica l'evento
2. Se status ∉ ('OK', 'CONFIRMED') → non fa nulla
3. Se standard_onsite o standard_cologno vuoti → non fa nulla
4. Legge i requirements per standard_onsite + standard_cologno (senza filtro site)
5. Per ogni requirement: conta gli assignments esistenti per evento+ruolo; se < quantity, crea gli slot mancanti

Viene chiamata automaticamente:

- Dopo **PATCH /api/events/:id** se cambiano status, standardOnsite o standardCologno
- Dopo **POST /api/events** se l'evento è creato con status OK/CONFIRMED
- Dopo **import Excel** per ogni evento pronto

---

## Esempi curl

### Creare evento

```bash
curl -X POST http://localhost:4000/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "category": "MATCH",
    "competitionName": "SERIE A",
    "competitionCode": "SA",
    "matchDay": "1",
    "homeTeamNameShort": "GENOA",
    "awayTeamNameShort": "LECCE",
    "koItaly": "18:30",
    "preDurationMinutes": 75,
    "standardOnsite": "DAZN3",
    "standardCologno": "GALLERY01",
    "areaProduzione": "GALLERY01",
    "showName": "FUORICLASSE",
    "status": "OK"
  }'
```

### Aggiornare evento e generare slot se pronto

```bash
curl -X PATCH http://localhost:4000/api/events/1 \
  -H "Content-Type: application/json" \
  -d '{ "status": "CONFIRMED" }'
```

### Eventi pronti per designazioni

```bash
curl "http://localhost:4000/api/events?onlyDesignable=true"
```

### Leggere standard requirements

```bash
curl "http://localhost:4000/api/standard-requirements?standardOnsite=NO%20ONSITE&standardCologno=GALLERY01"
```

### Lista completa standard requirements (pagina Database)

```bash
curl "http://localhost:4000/api/standard-requirements?page=1&pageSize=50"
```
