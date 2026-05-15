import type { Page, Response } from 'playwright';
import { config } from './config.js';
import { EndpointNotFoundError, QrNotFoundError, ResponseTimeoutError } from './errors.js';

export type QrCaptureResult = {
  qrBase64: string;
  qrDataUrl?: string;
  pixPayload?: string;
  sourceUrl: string;
  expiresAt: string | null;
};

const QR_KEYS = new Set(['qrCode', 'qrcode', 'qr_code', 'base64', 'codeUrl', 'image']);

function looksLikeImageBase64(value: string): boolean {
  return /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i.test(value)
    || /^[A-Za-z0-9+/]{200,}={0,2}$/.test(value);
}

function looksLikeQrPayload(value: string): boolean {
  const normalized = value.trim();
  return looksLikeImageBase64(normalized)
    || normalized.startsWith('000201')
    || normalized.toLowerCase().includes('base64,');
}

function normalizeQrValue(value: string): string | null {
  const trimmed = value.trim();
  if (!looksLikeQrPayload(trimmed)) return null;

  const dataUriMatch = trimmed.match(/^data:image\/(?:png|jpe?g|webp);base64,(.+)$/i);
  return dataUriMatch?.[1] ?? trimmed;
}

function findQrInValue(value: unknown, preferredKey = false): string | null {
  if (typeof value === 'string') {
    if (!preferredKey) return null;

    const normalized = normalizeQrValue(value);
    if (normalized) return normalized;
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findQrInValue(item, preferredKey);
      if (found) return found;
    }
    return null;
  }

  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const found = findQrInValue(child, QR_KEYS.has(key));
      if (found) return found;
    }
  }

  return null;
}

export function extractQrFromResponse(responseBody: unknown): string | null {
  return findQrInValue(responseBody);
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers()['content-type'] ?? '';
  if (contentType.includes('application/json')) return response.json();
  return null;
}

function matchesConfiguredEndpoint(response: Response): boolean {
  if (!config.qrResponseUrlPattern) return true;
  return response.url().includes(config.qrResponseUrlPattern);
}

export async function waitForQrResponse(page: Page, action: () => Promise<void>): Promise<QrCaptureResult> {
  let sawConfiguredEndpoint = false;

  const responsePromise = new Promise<QrCaptureResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      page.off('response', onResponse);
      reject(
        sawConfiguredEndpoint
          ? new QrNotFoundError()
          : config.qrResponseUrlPattern
            ? new EndpointNotFoundError()
            : new ResponseTimeoutError(),
      );
    }, config.timeouts.responseMs);

    const onResponse = async (response: Response) => {
      if (!matchesConfiguredEndpoint(response)) return;
      sawConfiguredEndpoint = true;

      try {
        const body = await parseResponseBody(response);
        if (!body) return;

        const qrBase64 = extractQrFromResponse(body);
        if (!qrBase64) return;

        clearTimeout(timeout);
        page.off('response', onResponse);
        resolve({
          qrBase64,
          sourceUrl: response.url(),
          expiresAt: null,
        });
      } catch (error) {
        console.log(`[network] could not inspect response ${response.url()}: ${(error as Error).message}`);
      }
    };

    page.on('response', onResponse);
  });

  await action();
  return responsePromise;
}
