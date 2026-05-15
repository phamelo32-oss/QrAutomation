import { closeBrowserContext, newAutomationPage } from './browser.js';
import { config } from './config.js';
import { ensureAuthenticated } from './auth.js';
import { startServer } from './server.js';

process.on('unhandledRejection', (error) => {
  console.error('[process] unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('[process] uncaught exception:', error);
});

startServer();

if (config.warmupOnStart) {
  newAutomationPage().then(async (page) => {
    await ensureAuthenticated(page);
    await page.goto(config.topupUrl, { waitUntil: 'domcontentloaded' });
    console.log('[startup] browser ready on top-up page');
  }).catch((error) => {
    console.error('[startup] failed to prepare browser:', error);
  });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    console.log(`[process] received ${signal}, closing browser context`);
    await closeBrowserContext();
    process.exit(0);
  });
}
