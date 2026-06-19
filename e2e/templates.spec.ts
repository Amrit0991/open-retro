import { test, expect, request, type Page } from '@playwright/test';

// Magic-link login (mirrors golden-path/two-client): AUTH_TEST_MODE=1 makes
// /api/auth/request return the verify `devUrl`; hitting it sets the session
// cookie and redirects to /.
async function login(page: Page, email: string) {
  const ctx = await request.newContext({ baseURL: 'http://localhost:8787' });
  const res = await ctx.post('/api/auth/request', { data: { email } });
  const { devUrl } = await res.json();
  await page.goto(devUrl);
  await expect(page).toHaveURL('http://localhost:8787/');
  await ctx.dispose();
}

// Build a custom template, create a board from it, then prove the board carries a
// frozen SNAPSHOT: editing or deleting the live template never mutates an existing
// board. A unique name keeps the run isolated from the shared local D1.
test('custom template builds a board that snapshots independently of the template', async ({
  page,
}) => {
  await login(page, 'templates@x.com');

  const tplName = `Wins & Worries ${Date.now()}`;

  // 1. /templates → New template → name + 2 columns (distinct tones) → Save.
  await page.getByRole('link', { name: /templates/i }).click();
  await expect(page).toHaveURL(/\/templates$/);

  await page.getByRole('button', { name: /new template/i }).first().click();
  const builder = page.getByRole('dialog', { name: /new template/i });
  await builder.getByLabel(/template name/i).fill(tplName);

  // Builder starts with one column; add a second.
  await builder.getByRole('button', { name: /add column/i }).click();

  const titles = builder.getByLabel('column title');
  await titles.nth(0).fill('Wins');
  await titles.nth(1).fill('Worries');

  // Pick distinct tones (each column has its own swatch group).
  const groups = builder.getByRole('group', { name: 'column tone' });
  await groups.nth(0).getByLabel('tone green').click();
  await groups.nth(1).getByLabel('tone coral').click();

  await builder.getByRole('button', { name: /save template/i }).click();

  // 2. Back on /templates the new template appears.
  await expect(page.getByText(tplName, { exact: true })).toBeVisible();

  // 3. Go to the board list → Add board → select the custom template → Create.
  await page.getByRole('link', { name: /^boards$/i }).click();
  await expect(page).toHaveURL('http://localhost:8787/');

  await page.getByRole('button', { name: /add board/i }).click();
  await page.getByLabel(/name/i).fill('Snapshot Retro');
  // Custom templates list by bare name in the <select> (built-ins add " · N columns").
  await page.getByLabel(/template/i).selectOption({ label: tplName });
  await page.getByRole('button', { name: /create/i }).click();

  // 4. On the board, both custom column titles are visible. `exact` so the
  // column <h2>s don't collide with the board's <h1> templateName (which
  // contains both words).
  await expect(page).toHaveURL(/\/b\//);
  const boardUrl = page.url();
  await expect(page.getByRole('heading', { name: 'Wins', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Worries', exact: true })).toBeVisible();

  // 5. Snapshot check: edit the template, rename a column, save.
  // The board view has no Templates link, so navigate to the page directly.
  await page.goto('http://localhost:8787/templates');
  await expect(page).toHaveURL(/\/templates$/);
  await page
    .locator('.tmpl-row', { hasText: tplName })
    .getByRole('button', { name: /^edit$/i })
    .click();
  const editor = page.getByRole('dialog', { name: /edit template/i });
  const editTitles = editor.getByLabel('column title');
  await expect(editTitles.nth(0)).toHaveValue('Wins');
  await editTitles.nth(0).fill('Renamed');
  await editor.getByRole('button', { name: /save template/i }).click();
  await expect(page.getByText(tplName, { exact: true })).toBeVisible();

  // The existing board still shows the ORIGINAL "Wins" (snapshot, not live template).
  await page.goto(boardUrl);
  await expect(page.getByRole('heading', { name: 'Wins', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Renamed', exact: true })).toHaveCount(0);

  // 6. Delete the template — the board still loads from its own snapshot.
  await page.goto('http://localhost:8787/templates');
  await expect(page).toHaveURL(/\/templates$/);
  await page.getByRole('button', { name: `delete ${tplName}` }).click();
  await expect(page.getByText(tplName, { exact: true })).toHaveCount(0);

  await page.goto(boardUrl);
  await expect(page.getByRole('heading', { name: 'Wins', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Worries', exact: true })).toBeVisible();
});
