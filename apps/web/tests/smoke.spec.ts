import { test, expect } from '@playwright/test';

test('page loads and shows the app shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#root')).toBeAttached();
});
