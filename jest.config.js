/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  rootDir: './src',
  // Hardening: stomp DATABASE_URL before any module loads so accidental
  // real-DB connections fail fast instead of hitting the dev DB.
  setupFiles: ['<rootDir>/__tests__/jest-setup.ts'],
};
