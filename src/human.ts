import type { Locator, Page } from 'playwright';

function randomBetween(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

export async function humanPause(page: Page, minMs = 120, maxMs = 420): Promise<void> {
  await page.waitForTimeout(randomBetween(minMs, maxMs));
}

export async function humanType(page: Page, locator: Locator, value: string): Promise<void> {
  await locator.click();
  await humanPause(page);

  const existingValue = await locator.inputValue().catch(() => '');
  if (existingValue) {
    await page.keyboard.press('Control+A');
    await humanPause(page, 80, 180);
    await page.keyboard.press('Backspace');
    await humanPause(page, 100, 260);
  }

  for (const char of value) {
    await locator.pressSequentially(char, { delay: randomBetween(65, 180) });
    await humanPause(page, 20, 95);
  }
}

export async function setNativeInputValue(locator: Locator, value: string): Promise<void> {
  await locator.evaluate((element, nextValue) => {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      throw new Error('Element is not an input or textarea.');
    }

    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!valueSetter) {
      throw new Error('Native value setter was not found.');
    }

    valueSetter.call(element, '');
    element.dispatchEvent(new Event('input', { bubbles: true }));
    valueSetter.call(element, nextValue);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
