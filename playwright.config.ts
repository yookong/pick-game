import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  use: { ...devices['iPhone 13 Mini'], browserName: 'chromium', baseURL: 'http://127.0.0.1:4173',
    launchOptions: process.env.PICK_CHROME ? { executablePath: process.env.PICK_CHROME } : undefined },
  webServer: [
    { command: 'pnpm preview --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173' },
  ],
})
