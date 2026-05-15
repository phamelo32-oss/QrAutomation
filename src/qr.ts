import QRCode from 'qrcode';
import type { QrCaptureResult } from './network.js';

function isPixPayload(value: string): boolean {
  return value.trim().startsWith('000201');
}

function splitDataUrl(dataUrl: string): string {
  const [, base64] = dataUrl.split(',', 2);
  return base64 ?? dataUrl;
}

export async function prepareQrResult(result: QrCaptureResult): Promise<QrCaptureResult> {
  if (!isPixPayload(result.qrBase64)) return result;

  const pixPayload = result.qrBase64.trim();
  const qrDataUrl = await QRCode.toDataURL(pixPayload, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 512,
  });

  return {
    ...result,
    qrBase64: splitDataUrl(qrDataUrl),
    qrDataUrl,
    pixPayload,
  };
}
