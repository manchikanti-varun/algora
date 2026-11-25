# Algora

Bootcamp platform: courses with LeetCode problems, batches with per-batch chapter unlocking, student progress, leaderboards and analytics.

- `algora-frontend/`: Next.js 16 (Vercel)
- `algora-backend/`: Express 5 + MongoDB (Railway + Atlas)

## Run locally

Prerequisites: Node 20+. MongoDB must be a replica set for synchronization (Atlas, or `mongod --replSet rs0` followed by `rs.initiate()`).

```bash
# backend
cd algora-backend && cp .env.example .env   # fill GOOGLE_CLIENT_ID, SUPER_ADMIN_EMAIL, SESSION_SECRET; PORT=5100 on macOS
npm install && npm run dev

# frontend
cd algora-frontend && cp .env.example .env.local   # BACKEND_URL=http://localhost:5100, NEXT_PUBLIC_GOOGLE_CLIENT_ID=<same client id>
npm install && npm run dev
```

## Tests

```bash
cd algora-backend
npm test                       # unit, integration and multi-process (in-memory replica set)
npm run test:browser           # Chromium e2e; first build the frontend with:
                               #   NEXT_PUBLIC_GOOGLE_CLIENT_ID=e2e-test-client BACKEND_URL=http://127.0.0.1:5100 npm run build
npm run test:load              # 200 students, mocked provider (LOAD_STUDENTS, LOAD_SECONDS)
```

The browser and load harnesses stub Google token verification and use the development mock LeetCode provider. They never contact Google or LeetCode.
