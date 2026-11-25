'use client'; // Error boundaries must be Client Components

/** Replaces the root layout when it fails, so it defines its own <html> and <body> and inline styles. */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  console.error(error);
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0, background: '#f8fafc', color: '#0f172a' }}>
        <title>Algora · Error</title>
        <div style={{ textAlign: 'center', maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Algora is having trouble</h1>
          <p style={{ fontSize: 14, color: '#475569' }}>Please try again in a moment.</p>
          <button onClick={() => retry()} style={{ marginTop: 16, padding: '8px 14px', borderRadius: 8, border: 0, background: '#4f46e5', color: '#fff', fontWeight: 500, cursor: 'pointer' }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
