const { test, expect } = require('@playwright/test');

test('admin login surface is available when authentication is not configured', async ({ page }) => {
  await page.goto('/admin.html');
  await expect(page.locator('#setup')).toBeVisible();
  await expect(page.locator('#setup-message')).toContainText('登入或資料庫尚未設定');
});

test('admin preview exposes customer support and lead workspaces', async ({ page }) => {
  await page.goto('/admin.html?preview=1');
  await expect(page.locator('#app')).toBeVisible();
  await page.locator('[data-nav-page="support"]').click();
  await expect(page.locator('[data-workspace="support"]')).toBeVisible();
  await expect(page.locator('#support-list')).toContainText('網站導入');
  await page.locator('[data-nav-page="leads"]').click();
  await expect(page.locator('[data-workspace="leads"]')).toBeVisible();
  await expect(page.locator('#leads-list')).toContainText('王小明');
});

test('embed loader establishes iframe messaging and forwards host state', async ({ page }) => {
  await page.goto('/tests/e2e/e2e-host.html');
  const frame = page.frameLocator('iframe[title="AI 虛擬人助理"]');
  await expect(frame.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => window.AvatarWidget.setContext({ product:'E2E' }));
  await expect(frame.locator('body')).toHaveAttribute('data-last-message', 'context');
});
