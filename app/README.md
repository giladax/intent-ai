# app/ — Quire dashboard SPA

React + Vite + Tailwind. Moved from `journal/src/web/ui/` as part of Slice 8
(dashboard migrated to the Python FastAPI backend).

## Dev mode

```bash
# Start the backend first (serves /api/*)
cd backend && python3 -m quire.cli serve --port 3456

# In another terminal — Vite dev server with HMR
cd app && npm install && npm run dev
# → http://localhost:5173/  (proxies /api to http://localhost:3456)
```

## Production build

```bash
cd app && npm run build
# → outputs to backend/quire/static/dashboard/
# Served by FastAPI at / (root of the port)
```

Then `python3 -m quire.cli serve --port 3456` serves the full dashboard at:
- `http://localhost:3456/` — the SPA (root, Express-parity)
- `http://localhost:3456/api/*` — the journal + alignment API
