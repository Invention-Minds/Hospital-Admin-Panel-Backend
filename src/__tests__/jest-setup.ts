/**
 * Jest global setup — runs before any module is loaded.
 *
 * Hardening against accidental real-DB connections in tests.
 *
 * Every test file MUST mock `service/prisma-client` (or any Prisma-touching
 * collaborator). If a future test forgets, the default DATABASE_URL from .env
 * would be used, pointing at the dev DB. By stomping it with an unreachable
 * URL here, any accidental real connection fails fast with a loud error
 * instead of silently mutating the dev DB.
 */
process.env.DATABASE_URL =
  'mysql://test:test@127.0.0.1:1/NO_REAL_DB_FOR_TESTS';
