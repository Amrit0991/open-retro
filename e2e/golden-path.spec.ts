import { test, expect, request, type Page } from '@playwright/test';

// Magic-link login: AUTH_TEST_MODE=1 makes /api/auth/request return the verify
// `devUrl`; hitting it sets the session cookie and redirects to /.
async function login(page: Page, email: string) {
  const ctx = await request.newContext({ baseURL: 'http://localhost:8787' });
  const res = await ctx.post('/api/auth/request', { data: { email } });
  const { devUrl } = await res.json();
  await page.goto(devUrl); // verify link sets the cookie and redirects to /
  await expect(page).toHaveURL('http://localhost:8787/');
  await ctx.dispose();
}

test('create board, add card, vote, see it', async ({ page }) => {
  await login(page, 'golden@x.com');

  await page.getByRole('button', { name: /add board/i }).click();
  await page.getByLabel(/name/i).fill('E2E Retro');
  await page.getByLabel(/template/i).selectOption('three_little_pigs');
  await page.getByRole('button', { name: /create/i }).click();
  await expect(page).toHaveURL(/\/b\//);

  const add = page.getByLabel('add card').first();
  await add.fill('ship it');
  await add.press('Enter');
  await expect(page.getByText('ship it')).toBeVisible();

  await page.getByLabel('upvote').first().click();
  // `exact` so this matches the card's vote-count span, not the owner's
  // "Max votes" header input (whose accessible name also contains "votes").
  await expect(page.getByLabel('votes', { exact: true }).first()).toHaveText('1');
});
