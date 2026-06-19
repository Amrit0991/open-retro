import { test, expect, request, chromium, type Page } from '@playwright/test';

// Two isolated browser contexts (separate sessions). Client A creates a board and
// adds a card; client B — joined to the same board — must see the card live over
// the BoardRoom WebSocket without reloading.
test('a card added by client A appears for client B', async () => {
  const browser = await chromium.launch();
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pageA = await a.newPage();
  const pageB = await b.newPage();

  const sign = async (page: Page, email: string) => {
    const ctx = await request.newContext({ baseURL: 'http://localhost:8787' });
    const { devUrl } = await (await ctx.post('/api/auth/request', { data: { email } })).json();
    await page.goto(devUrl);
    await ctx.dispose();
  };
  await sign(pageA, 'a@x.com');
  await sign(pageB, 'b@x.com');

  // A creates a board.
  await pageA.getByRole('button', { name: /add board/i }).click();
  await pageA.getByLabel(/name/i).fill('Shared');
  await pageA.getByRole('button', { name: /create/i }).click();
  await expect(pageA).toHaveURL(/\/b\//);
  const url = pageA.url();

  // B opens the same link (joins), then A adds a card.
  await pageB.goto(url);
  await expect(pageB.getByRole('heading', { name: /House of Straws/i })).toBeVisible();

  const add = pageA.getByLabel('add card').first();
  await add.fill('realtime!');
  await add.press('Enter');

  // B receives it live over the WebSocket.
  await expect(pageB.getByText('realtime!')).toBeVisible({ timeout: 5000 });

  await browser.close();
});
