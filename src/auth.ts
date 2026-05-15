import type { Page } from 'playwright';
import { config } from './config.js';
import { LayoutChangedError, LoginInvalidError, SessionExpiredError } from './errors.js';
import { humanPause, humanType } from './human.js';

async function isVisible(page: Page, selector: string, timeout = 2_000): Promise<boolean> {
  try {
    await page.locator(selector).first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

export async function waitForCloudflareIfNeeded(page: Page): Promise<void> {
  const challenge = page.locator('iframe[src*="challenges.cloudflare.com"]').first();
  const detected = await challenge.waitFor({ state: 'attached', timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (!detected) return;

  console.log('[auth] Cloudflare challenge detected, waiting for manual validation');
  const cleared = await page.waitForFunction(
    () => !document.querySelector('iframe[src*="challenges.cloudflare.com"]'),
    undefined,
    { timeout: 60_000 },
  )
    .then(() => true)
    .catch(() => false);

  if (!cleared) {
    throw new SessionExpiredError('Cloudflare challenge is still active after 60 seconds.');
  }
}

export async function isOnLoginPage(page: Page): Promise<boolean> {
  if (page.url().includes('/#/sd-login') || page.url().includes('/#/sd-signup')) return true;
  return isVisible(page, config.selectors.loginUsername);
}

export async function isAuthenticated(page: Page): Promise<boolean> {
  console.log('[auth] checking current session');
  await page.goto(config.topupUrl, { waitUntil: 'domcontentloaded' });
  await waitForCloudflareIfNeeded(page);

  if (await isOnLoginPage(page)) return false;

  if (config.selectors.authenticatedMarker) {
    return isVisible(page, config.selectors.authenticatedMarker, 5_000);
  }

  return isVisible(page, config.selectors.topupAmount, 5_000);
}

async function fillLoginForm(page: Page): Promise<void> {
  try {
    await humanType(page, page.locator(config.selectors.loginUsername), config.username);
    await humanPause(page, 300, 800);
    await humanType(page, page.locator(config.selectors.loginPassword), config.password);
    await humanPause(page, 500, 1_200);
  } catch (error) {
    throw new LayoutChangedError(`Login form selectors were not found: ${(error as Error).message}`);
  }
}

async function submitLogin(page: Page): Promise<void> {
  try {
    await humanPause(page, 400, 1_000);
    await page.locator(config.selectors.loginSubmit).filter({ hasText: /entrar|login|sign in/i }).click();
  } catch {
    await page.locator(config.selectors.loginSubmit).click();
  }
}

async function waitForAuthentication(page: Page): Promise<void> {
  const loginHidden = page
    .locator(config.selectors.loginUsername)
    .first()
    .waitFor({ state: 'hidden', timeout: config.timeouts.loginMs });

  const urlChanged = page.waitForURL((url) => !url.href.includes('/#/sd-login'), {
    timeout: config.timeouts.loginMs,
  });

  const successMarker = config.selectors.loginSuccess
    ? page.locator(config.selectors.loginSuccess).first().waitFor({
        state: 'visible',
        timeout: config.timeouts.loginMs,
      })
    : page.waitForTimeout(config.timeouts.loginMs);

  await Promise.race([loginHidden, urlChanged, successMarker]);

  if (await isOnLoginPage(page)) {
    throw new LoginInvalidError();
  }
}

export async function login(page: Page): Promise<void> {
  console.log('[auth] opening login page');
  await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded' });
  await waitForCloudflareIfNeeded(page);
  await fillLoginForm(page);
  await submitLogin(page);
  await waitForAuthentication(page);
  console.log('[auth] login confirmed');
}

export async function ensureAuthenticated(page: Page): Promise<void> {
  if (await isAuthenticated(page)) {
    console.log('[auth] existing session is valid');
    return;
  }

  console.log('[auth] no valid session, logging in');
  await login(page);

  await page.goto(config.topupUrl, { waitUntil: 'domcontentloaded' });
  await waitForCloudflareIfNeeded(page);
  if (await isOnLoginPage(page)) {
    throw new SessionExpiredError('Application redirected to login after authentication.');
  }
}
