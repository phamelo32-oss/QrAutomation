import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import type { QrCaptureResult } from './network.js';

function safeTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function base64ToBuffer(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

export async function saveQrCapture(result: QrCaptureResult): Promise<string> {
  await mkdir(config.qrOutputDir, { recursive: true });

  const stamp = safeTimestamp();
  const jsonPath = join(config.qrOutputDir, `${stamp}.json`);
  const pngPath = join(config.qrOutputDir, `${stamp}.png`);
  const latestJsonPath = join(config.qrOutputDir, 'latest.json');
  const latestPngPath = join(config.qrOutputDir, 'latest.png');

  const payload = {
    createdAt: new Date().toISOString(),
    sourceUrl: result.sourceUrl,
    expiresAt: result.expiresAt,
    pixPayload: result.pixPayload ?? null,
    qrDataUrl: result.qrDataUrl ?? `data:image/png;base64,${result.qrBase64}`,
  };

  await writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  await writeFile(latestJsonPath, JSON.stringify(payload, null, 2), 'utf8');
  await writeFile(pngPath, base64ToBuffer(result.qrBase64));
  await writeFile(latestPngPath, base64ToBuffer(result.qrBase64));

  return jsonPath;
}
