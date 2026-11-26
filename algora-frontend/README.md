# algora-frontend

Next.js 16 app for Algora, deployed on Vercel. It proxies `/api/v1/*` to the Express backend.

```bash
cp .env.example .env.local   # BACKEND_URL=http://localhost:5100, NEXT_PUBLIC_GOOGLE_CLIENT_ID=<Google client id>
npm install
npm run dev                  # http://localhost:3000
npm run typecheck && npm run lint && npm run build
```

Vercel environment: `BACKEND_URL=https://<railway-domain>` (read at build time, so redeploy after changing it) and `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

The browser never contacts LeetCode. Student progress updates come from the backend's synchronization queue.
