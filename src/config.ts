import { resolve } from 'node:path';

const storageRoot = resolve('storage');

export const config = {
  baseUrl: 'https://e66fun.com/',
  loginUrl: 'https://e66fun.com/#/sd-login',
  topupUrl: 'https://e66fun.com/#/sd-topup',
  port: 3000,
  username: '11910937039',
  password: 'Pedro95590',
  headless: false,
  warmupOnStart: false,
  browserChannel: 'chrome',
  storageRoot,
  userDataDir: resolve(storageRoot, 'browser-profile'),
  qrOutputDir: resolve(storageRoot, 'qr-codes'),
  timeouts: {
    navigationMs: 30_000,
    selectorMs: 20_000,
    loginMs: 30_000,
    responseMs: 30_000,
  },
  selectors: {
    loginUsername: '.login-item-input >> nth=0',
    loginPassword: '.login-item-input >> nth=1',
    loginSubmit: '.signup-item-signup-enable',
    loginSuccess: undefined,
    authenticatedMarker: undefined,
    topupAmount: '#input-amount',
    topupSubmit: '.signup-item-signup-enable',
  },
  qrResponseUrlPattern: undefined,
} as const;
