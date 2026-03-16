# API Designazioni – Esempi curl

Server di default: `http://localhost:4000` (override con `PORT` env).

Vedi anche `docs/API_STANDARD_REQUIREMENTS.md` per requirements e generazione da standard.

## Creare uno slot di designazione vuoto

```bash
curl -X POST http://localhost:4000/api/assignments \
  -H "Content-Type: application/json" \
  -d '{"eventId": 1, "roleId": 8}'
```

## Aggiornare un assignment

```bash
curl -X PATCH http://localhost:4000/api/assignments/1 \
  -H "Content-Type: application/json" \
  -d '{"staffId": 11, "status": "SENT", "notes": "Prima chiamata"}'
```

## Cambiare lo stato designazioni di un evento

```bash
curl -X PATCH http://localhost:4000/api/events/1/assignments-status \
  -H "Content-Type: application/json" \
  -d '{"assignmentsStatus": "READY_TO_SEND"}'
```

## Lista designazioni per evento

```bash
curl "http://localhost:4000/api/assignments?eventId=1"
```
