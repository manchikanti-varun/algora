Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://unused',
  GOOGLE_CLIENT_ID: 'test-client',
  SUPER_ADMIN_EMAIL: 'Admin@Example.com',
  SESSION_SECRET: 'x'.repeat(40),
  FRONTEND_URL: 'http://localhost:3000',
});
