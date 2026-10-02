import { test, expect, request, type Page } from '@playwright/test';

async function login(page: Page, email: string) {
  const ctx = await request.newContext({ baseURL: 'http://localhost:8787' });
  const res = await ctx.post('/api/auth/request', { data: { email } });
  const { devUrl } = await res.json();
  await page.goto(devUrl);
  await expect(page).toHaveURL('http://localhost:8787/');
  await ctx.dispose();
}

test('takeaways, card edit, and votes left survive a reload', async ({ page }) => {
  await login(page, 'features@x.com');
  await page.getByRole('button', { name: /add board/i }).click();
  await page.getByLabel(/name/i).fill('Features Retro');
  await page.getByLabel(/template/i).selectOption('sailboat');
  await page.getByRole('button', { name: /create/i }).click();
  await expect(page).toHaveURL(/\/b\//);

  const adds = page.getByLabel('add card');
  await adds.first().fill('typo here');
  await adds.first().press('Enter');
  await adds.last().fill('write the runbook');
  await adds.last().press('Enter');
  await expect(page.locator('.takeaways').getByText('write the runbook')).toBeVisible();

  const votesLeft = page.getByLabel('votes left');
  const before = Number(await votesLeft.locator('.n').innerText());
  await page.getByLabel('upvote').first().click();
  await expect(votesLeft.locator('.n')).toHaveText(String(before - 1));

  const card = page.locator('.card', { hasText: 'typo here' });
  await card.hover();
  await card.getByRole('button', { name: 'edit' }).click();
  const box = page.getByRole('textbox', { name: 'edit card' });
  await box.fill('fixed text');
  await box.press('Enter');
  await expect(page.getByText('fixed text')).toBeVisible();

  await page.reload();
  await expect(page.getByText('fixed text')).toBeVisible();
  await expect(page.getByText('typo here')).toHaveCount(0);
  await expect(page.locator('.takeaways').getByText('write the runbook')).toBeVisible();
  await expect(votesLeft.locator('.n')).toHaveText(String(before - 1));
});
