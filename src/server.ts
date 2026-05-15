import express, { type Request, type Response } from 'express';
import type { Page } from 'playwright';
import { newAutomationPage } from './browser.js';
import { config } from './config.js';
import { AutomationError } from './errors.js';
import { generateTopupQr, type GenerateTopupInput } from './topup.js';
import { saveQrCapture } from './storage.js';

function validateBody(body: unknown): GenerateTopupInput {
  if (!body || typeof body !== 'object') {
    throw new AutomationError('Request body must be a JSON object.', 'INVALID_BODY', 400);
  }

  const input = body as Partial<GenerateTopupInput>;
  if (!input.amount || typeof input.amount !== 'string') {
    throw new AutomationError('Field "amount" is required and must be a string.', 'INVALID_AMOUNT', 400);
  }

  if (input.fields !== undefined && (typeof input.fields !== 'object' || Array.isArray(input.fields))) {
    throw new AutomationError('Field "fields" must be an object of selector/value pairs.', 'INVALID_FIELDS', 400);
  }

  return {
    amount: input.amount,
    fields: input.fields,
  };
}

export function createServer() {
  const app = express();

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }

    next();
  });

  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post('/generate-topup', async (req: Request, res: Response) => {
    console.log('[server] POST /generate-topup received');
    let page: Page | null = null;

    try {
      const input = validateBody(req.body);
      console.log(`[server] generating top-up QR for amount ${input.amount}`);
      page = await newAutomationPage();
      const result = await generateTopupQr(page, input);
      const savedTo = await saveQrCapture(result);

      console.log(`[server] top-up QR ready from ${result.sourceUrl}`);
      res.json({
        success: true,
        savedTo,
        qrBase64: result.qrBase64,
        qrDataUrl: result.qrDataUrl,
        pixPayload: result.pixPayload,
        sourceUrl: result.sourceUrl,
        expiresAt: result.expiresAt,
      });
    } catch (error) {
      const statusCode = error instanceof AutomationError ? error.statusCode : 500;
      const code = error instanceof AutomationError ? error.code : 'UNEXPECTED_ERROR';

      console.error(`[server] ${code}:`, error);
      res.status(statusCode).json({
        success: false,
        error: {
          code,
          message: (error as Error).message,
        },
      });
    } finally {
      await page?.close().catch(() => undefined);
    }
  });

  return app;
}

export function startServer() {
  const app = createServer();
  app.listen(config.port, () => {
    console.log(`[server] listening on http://localhost:${config.port}`);
  });
}
