Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://unused',
  GOOGLE_CLIENT_ID: 'test-client',
  SUPER_ADMIN_EMAIL: 'Admin@Example.com',
  SESSION_SECRET: 'x'.repeat(40),
  FRONTEND_URL: 'http://localhost:3000',
  // Tests exercise logic, not pacing: a generous shared budget. Tests of the budget set their own limits.
  LEETCODE_GLOBAL_RATE_PER_MIN: '600',
  LEETCODE_ALFA_RATE_PER_MIN: '600',
  LEETCODE_MAX_FAILOVER: '2', // the failover suite uses three providers; the production default (1) has its own test
});
