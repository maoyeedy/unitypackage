import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/static/editor-packed.unitypackage');

test.describe('explorer interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Open package').setInputFiles(fixturePath);
    await expect(page.getByText(/Parsed \d+ records/)).toBeVisible({ timeout: 15_000 });
  });

  test('search filters visible records', async ({ page }) => {
    const recordCount = page.getByRole('region', { name: 'Package explorer' }).getByText(/\d+ visible records/);
    const initial = await recordCount.textContent();
    expect(initial).toMatch(/\d+ visible records/);
    await page.getByPlaceholder('Filter path, GUID, or kind').fill('xyznotexist');
    await expect(recordCount).toContainText('0 visible records');
  });

  test('clearing search restores all records', async ({ page }) => {
    const recordCount = page.getByRole('region', { name: 'Package explorer' }).getByText(/\d+ visible records/);
    const initial = await recordCount.textContent();
    await page.getByPlaceholder('Filter path, GUID, or kind').fill('xyznotexist');
    await expect(recordCount).toContainText('0 visible records');
    await page.getByPlaceholder('Filter path, GUID, or kind').clear();
    await expect(recordCount).toHaveText(initial ?? '');
  });

  test('Extension grouping replaces tree with extension group headers', async ({ page }) => {
    await page.getByRole('button', { name: 'Extension' }).click();
    await expect(page.getByRole('tree', { name: 'Package file tree' })).not.toBeVisible();
    const explorerPanel = page.getByRole('region', { name: 'Package explorer' });
    await expect(explorerPanel.getByRole('heading', { level: 3 }).first()).toBeVisible();
  });

  test('Tree grouping restores the file tree', async ({ page }) => {
    await page.getByRole('button', { name: 'Extension' }).click();
    await page.getByRole('button', { name: 'Tree' }).click();
    await expect(page.getByRole('tree', { name: 'Package file tree' })).toBeVisible();
  });

  test('selecting a file enables Clear selection and Selected ZIP', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Clear selection' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Selected ZIP' })).toBeDisabled();
    await page.getByRole('checkbox', { name: /^Select/, disabled: false }).first().click();
    await expect(page.getByRole('button', { name: 'Clear selection' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Selected ZIP' })).toBeEnabled();
  });

  test('Clear selection deselects all and disables selection buttons', async ({ page }) => {
    await page.getByRole('checkbox', { name: /^Select/, disabled: false }).first().click();
    await expect(page.getByRole('button', { name: 'Clear selection' })).toBeEnabled();
    await page.getByRole('button', { name: 'Clear selection' }).click();
    await expect(page.getByRole('button', { name: 'Clear selection' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Selected ZIP' })).toBeDisabled();
  });
});
