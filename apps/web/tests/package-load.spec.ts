import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/static/archives/Polytope_URP.unitypackage');

test.describe('package loading', () => {
  test('status updates after successful parse', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Open package').setInputFiles(fixturePath);
    await expect(page.getByText(/Parsed \d+ records from Polytope_URP\.unitypackage/)).toBeVisible({ timeout: 15_000 });
  });

  test('file tree appears and empty state is removed', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Open package').setInputFiles(fixturePath);
    await expect(page.getByText(/Parsed \d+ records/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'No records loaded' })).not.toBeVisible();
    await expect(page.getByRole('tree', { name: 'Package file tree' })).toBeVisible();
  });

  test('preview panel shows the first record after load', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Open package').setInputFiles(fixturePath);
    await expect(page.getByText(/Parsed \d+ records/)).toBeVisible({ timeout: 15_000 });
    const previewPanel = page.getByRole('complementary', { name: 'Preview and metadata' });
    await expect(previewPanel.getByRole('heading', { name: 'No file selected' })).not.toBeVisible();
  });

  test('package filename appears in the header brand', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Open package').setInputFiles(fixturePath);
    await expect(page.getByText(/Parsed \d+ records/)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.brand p')).toHaveText('Polytope_URP.unitypackage');
  });

  test('All ZIP button becomes enabled after load', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'All ZIP' })).toBeDisabled();
    await page.getByLabel('Open package').setInputFiles(fixturePath);
    await expect(page.getByText(/Parsed \d+ records/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'All ZIP' })).toBeEnabled();
  });

  test('reopen from recents entry after page reload', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Open package').setInputFiles(fixturePath);
    await expect(page.getByText(/Parsed \d+ records/)).toBeVisible({ timeout: 15_000 });

    // Verify recents list contains the package
    await page.getByRole('button', { name: 'Recent packages' }).click();
    await expect(page.locator('.recent-item')).toContainText('Polytope_URP.unitypackage');

    // Reload page
    await page.reload();

    // Verify it is still in recents and tree is empty
    await page.getByRole('button', { name: 'Recent packages' }).click();
    await expect(page.locator('.recent-item')).toContainText('Polytope_URP.unitypackage');
    await expect(page.getByRole('heading', { name: 'No records loaded' })).toBeVisible();

    // Click recent item to trigger reopen prompt
    await page.locator('.recent-item').click();
    await expect(page.getByRole('heading', { name: 'Reopen Recent Package' })).toBeVisible();

    // Select the file in modal file input
    await page.locator('.modal-dropzone input[type="file"]').setInputFiles(fixturePath);

    // Verify the package loaded and modal closed
    await expect(page.getByText(/Parsed \d+ records/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Reopen Recent Package' })).not.toBeVisible();
  });

  test('persistence and rehydration of grouping and sort preferences', async ({ page }) => {
    await page.goto('/');

    // Change sort and grouping
    await page.locator('#sort-key').selectOption('size');
    await page.getByRole('button', { name: 'Extension', exact: true }).click();

    // Verify immediately applied
    await expect(page.locator('#sort-key')).toHaveValue('size');
    await expect(page.getByRole('button', { name: 'Extension', exact: true })).toHaveClass(/active/);

    // Reload page
    await page.reload();

    // Verify rehydrated values
    await expect(page.locator('#sort-key')).toHaveValue('size');
    await expect(page.getByRole('button', { name: 'Extension', exact: true })).toHaveClass(/active/);
  });
});
