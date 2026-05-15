import { chromium, type BrowserContext, type Page } from 'playwright';
import { config } from './config.js';

let contextPromise: Promise<BrowserContext> | null = null;

export async function getBrowserContext(): Promise<BrowserContext> {
  if (!contextPromise) {
    console.log(`[browser] launching persistent context at ${config.userDataDir}`);
    const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
      headless: config.headless,
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      viewport: null,
      args: ['--disable-blink-features=AutomationControlled'],
    };

    if (config.browserChannel) {
      launchOptions.channel = config.browserChannel;
    }

    contextPromise = chromium.launchPersistentContext(config.userDataDir, launchOptions).then((context) => {
      context.on('close', () => {
        contextPromise = null;
      });
      return context;
    }).catch((error) => {
      contextPromise = null;
      throw error;
    });
  }

  return contextPromise;
}

export async function newAutomationPage(): Promise<Page> {
  const context = await getBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(config.timeouts.selectorMs);
  page.setDefaultNavigationTimeout(config.timeouts.navigationMs);
  return page;
}

export async function openStartupPage(): Promise<void> {
  const context = await getBrowserContext();
  const page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(config.timeouts.selectorMs);
  page.setDefaultNavigationTimeout(config.timeouts.navigationMs);
  await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded' });
}

export async function closeBrowserContext(): Promise<void> {
  if (!contextPromise) return;
  const context = await contextPromise;
  contextPromise = null;
  await context.close();
}
