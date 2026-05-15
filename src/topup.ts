import type { Frame, Page } from 'playwright';
import { config } from './config.js';
import { ensureAuthenticated, isOnLoginPage, waitForCloudflareIfNeeded } from './auth.js';
import { AutomationError, LayoutChangedError, SessionExpiredError } from './errors.js';
import { waitForQrResponse, type QrCaptureResult } from './network.js';
import { prepareQrResult } from './qr.js';
import { humanPause, humanType, setNativeInputValue } from './human.js';

export type GenerateTopupInput = {
  amount: string;
  fields?: Record<string, string>;
};

async function topupState(page: Page): Promise<string> {
  const state = await page.evaluate((selectors) => {
    const amount = document.querySelector<HTMLInputElement>(selectors.amount);
    const buttons = Array.from(document.querySelectorAll<HTMLElement>(selectors.submit)).map((button) => ({
      text: button.innerText.trim(),
      display: getComputedStyle(button).display,
      visibility: getComputedStyle(button).visibility,
    }));
    const iframeSrcs = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe')).map((iframe) => iframe.src);

    return {
      url: location.href,
      amountValue: amount?.value ?? null,
      buttons,
      iframeSrcs,
      bodyText: document.body.innerText.trim().slice(0, 500),
    };
  }, { amount: config.selectors.topupAmount, submit: config.selectors.topupSubmit }).catch((error) => ({
    url: page.url(),
    error: (error as Error).message,
  }));

  return JSON.stringify(state);
}

function sameNumericValue(actual: string, expected: string): boolean {
  if (actual === expected) return true;

  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  return Number.isFinite(actualNumber) && Number.isFinite(expectedNumber) && actualNumber === expectedNumber;
}

async function hasPaymentFrame(page: Page): Promise<boolean> {
  return await page.locator('iframe[src]:not([src*="challenges.cloudflare.com"])').first().isVisible().catch(() => false);
}

async function resetTopupPage(page: Page): Promise<void> {
  if (!(await hasPaymentFrame(page))) return;

  console.log('[topup] existing payment iframe detected, resetting top-up page');
  await page.locator('.back, .top-nav-leftimg').first().click({ timeout: 5_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  await page.goto(config.topupUrl, { waitUntil: 'domcontentloaded' });
  await waitForCloudflareIfNeeded(page);

  if (await hasPaymentFrame(page)) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForCloudflareIfNeeded(page);
  }

  if (await hasPaymentFrame(page)) {
    throw new LayoutChangedError(`Could not clear existing payment iframe before creating a new top-up. State: ${await topupState(page)}`);
  }
}

async function waitForTopupForm(page: Page): Promise<void> {
  const amount = page.locator(config.selectors.topupAmount).first();
  try {
    console.log('[topup] waiting for amount input');
    await amount.waitFor({ state: 'visible', timeout: config.timeouts.selectorMs });
  } catch (error) {
    if (await isOnLoginPage(page)) {
      throw new SessionExpiredError('Top-up route redirected to login.');
    }

    throw new LayoutChangedError(`Top-up form was not ready: ${(error as Error).message}. State: ${await topupState(page)}`);
  }
}

async function fillAmount(page: Page, amount: string): Promise<void> {
  const amountInput = page.locator(config.selectors.topupAmount).first();
  const submitButton = page.locator(config.selectors.topupSubmit).filter({ hasText: /dep|deposit|gerar|confirmar/i }).first();
  await amountInput.scrollIntoViewIfNeeded();

  console.log(`[topup] filling amount ${amount}`);
  try {
    await humanType(page, amountInput, amount);
    await amountInput.dispatchEvent('input');
    await amountInput.dispatchEvent('change');
  } catch {
    await setNativeInputValue(amountInput, amount);
  }

  await page.waitForTimeout(300);
  const typedValue = await amountInput.inputValue().catch(() => '');
  const submitEnabled = await submitButton.isVisible().catch(() => false);
  if (!sameNumericValue(typedValue, amount) || !submitEnabled) {
    await setNativeInputValue(amountInput, amount);
  }

  await page.waitForFunction(
    ({ selector, expected }) => {
      const element = document.querySelector<HTMLInputElement>(selector);
      if (!element) return false;

      const actualNumber = Number(element.value);
      const expectedNumber = Number(expected);
      return (
        element.value === expected ||
        (Number.isFinite(actualNumber) && Number.isFinite(expectedNumber) && actualNumber === expectedNumber)
      );
    },
    { selector: config.selectors.topupAmount, expected: amount },
    { timeout: config.timeouts.selectorMs },
  );
  await submitButton.waitFor({ state: 'visible', timeout: config.timeouts.selectorMs }).catch(async (error) => {
    throw new LayoutChangedError(`Deposit button did not become enabled: ${(error as Error).message}. State: ${await topupState(page)}`);
  });
}

async function fillTopupForm(page: Page, input: GenerateTopupInput): Promise<void> {
  try {
    await waitForTopupForm(page);
    await fillAmount(page, input.amount);
    await humanPause(page, 600, 1_400);

    // Use fields para inputs adicionais, exemplo:
    // { "input[name='cpf']": "00000000000", "input[name='name']": "Cliente" }
    for (const [selector, value] of Object.entries(input.fields ?? {})) {
      await humanType(page, page.locator(selector), value);
      await humanPause(page, 300, 900);
    }
  } catch (error) {
    if (error instanceof AutomationError) {
      throw error;
    }

    throw new LayoutChangedError(`Top-up form selectors were not found: ${(error as Error).message}`);
  }
}

function extractExpiresAtFromPixUrl(url: string): string | null {
  const cid = new URL(url).searchParams.get('cid');
  if (!cid) return null;

  const match = cid.match(/expireAt\s+(.+)$/i);
  return match?.[1] ?? null;
}

function base64FromDataUrl(dataUrl: string): string {
  const [, base64] = dataUrl.split(',', 2);
  return base64 ?? dataUrl;
}

async function extractQrFromPaymentFrame(frame: Frame, sourceUrl: string): Promise<QrCaptureResult> {
  await frame.waitForLoadState('domcontentloaded', { timeout: config.timeouts.responseMs }).catch(() => undefined);

  const extracted = await frame.waitForFunction(() => {
    const image = document.querySelector<HTMLImageElement>('img[src^="data:image/"]');
    if (image?.src) {
      return { kind: 'dataUrl', value: image.src };
    }

    const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas'));
    for (const canvas of canvases) {
      if (canvas.width <= 20 || canvas.height <= 20) continue;

      try {
        const dataUrl = canvas.toDataURL('image/png');
        if (dataUrl.startsWith('data:image/png;base64,')) {
          return { kind: 'dataUrl', value: dataUrl };
        }
      } catch {
        // Cross-origin tainted canvases cannot be read; keep looking.
      }
    }

    const valueElements = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'));
    for (const element of valueElements) {
      const value = element.value.trim();
      if (value.startsWith('000201')) {
        return { kind: 'pixPayload', value };
      }
    }

    const textMatch = document.body.innerText.match(/000201[0-9A-Z./:*\-+ ]{80,}/);
    if (textMatch) {
      return { kind: 'pixPayload', value: textMatch[0].trim() };
    }

    return null;
  }, undefined, { timeout: config.timeouts.responseMs });

  const result = await extracted.jsonValue() as { kind: 'dataUrl' | 'pixPayload'; value: string } | null;
  if (!result) {
    throw new LayoutChangedError(`Payment iframe did not expose a QR image or PIX payload. Source: ${sourceUrl}`);
  }

  if (result.kind === 'dataUrl') {
    return {
      qrBase64: base64FromDataUrl(result.value),
      qrDataUrl: result.value,
      sourceUrl,
      expiresAt: extractExpiresAtFromPixUrl(sourceUrl),
    };
  }

  return {
    qrBase64: result.value,
    pixPayload: result.value,
    sourceUrl,
    expiresAt: extractExpiresAtFromPixUrl(sourceUrl),
  };
}

async function waitForQrIframe(page: Page): Promise<QrCaptureResult> {
  const iframe = page.locator('iframe[src]:not([src*="challenges.cloudflare.com"])').first();
  await iframe.waitFor({ state: 'attached', timeout: config.timeouts.responseMs });

  const sourceUrl = await iframe.getAttribute('src');
  if (!sourceUrl) {
    throw new LayoutChangedError('PIX iframe was found without src.');
  }

  const parsed = new URL(sourceUrl, page.url());
  const qrBase64 = parsed.searchParams.get('qrcode');
  if (qrBase64) {
    return {
      qrBase64,
      sourceUrl: parsed.href,
      expiresAt: extractExpiresAtFromPixUrl(sourceUrl),
    };
  }

  const handle = await iframe.elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) {
    throw new LayoutChangedError(`Payment iframe has no accessible frame. State: ${await topupState(page)}`);
  }

  return extractQrFromPaymentFrame(frame, parsed.href);
}

async function submitTopup(page: Page): Promise<void> {
  try {
    // Ajuste TOPUP_SUBMIT_SELECTOR para o botão real que gera o depósito/QR.
    await humanPause(page, 700, 1_600);
    await page.locator(config.selectors.topupSubmit).filter({ hasText: /dep|deposit|gerar|confirmar/i }).click();
  } catch {
    await page.locator(config.selectors.topupSubmit).click();
  }
}

async function submitAndWaitForQr(page: Page): Promise<QrCaptureResult> {
  const iframePromise = waitForQrIframe(page);
  const responsePromise = config.qrResponseUrlPattern
    ? waitForQrResponse(page, async () => undefined)
    : null;

  try {
    await submitTopup(page);
  } catch (error) {
    const existingQr = await iframePromise.catch(() => null);
    if (existingQr) return existingQr;

    responsePromise?.catch(() => undefined);
    throw new LayoutChangedError(`Could not click deposit button: ${(error as Error).message}. State: ${await topupState(page)}`);
  }

  try {
    if (!responsePromise) return await iframePromise;
    return await Promise.any([iframePromise, responsePromise]);
  } catch {
    throw new LayoutChangedError(`Top-up was submitted, but QR was not found. State: ${await topupState(page)}`);
  }
}

export async function generateTopupQr(page: Page, input: GenerateTopupInput): Promise<QrCaptureResult> {
  console.log('[topup] ensuring authenticated session');
  await ensureAuthenticated(page);

  console.log('[topup] opening top-up route');
  await page.goto(config.topupUrl, { waitUntil: 'domcontentloaded' });
  await waitForCloudflareIfNeeded(page);

  if (await isOnLoginPage(page)) {
    throw new SessionExpiredError('Top-up route redirected to login.');
  }

  await resetTopupPage(page);
  await fillTopupForm(page, input);

  console.log('[topup] submitting top-up form');
  const result = await prepareQrResult(await submitAndWaitForQr(page));
  console.log(`[topup] QR captured from ${result.sourceUrl}`);
  return result;
}
