import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/static/editor-packed.unitypackage');

test.describe('package loading', () => {
  test('status updates after successful parse', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Open package').setInputFiles(fixturePath);
    await expect(page.getByText(/Parsed \d+ records from editor-packed\.unitypackage/)).toBeVisible({ timeout: 15_000 });
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
    await expect(page.getByText('editor-packed.unitypackage', { exact: true })).toBeVisible();
  });

  test('All ZIP button becomes enabled after load', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'All ZIP' })).toBeDisabled();
    await page.getByLabel('Open package').setInputFiles(fixturePath);
    await expect(page.getByText(/Parsed \d+ records/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'All ZIP' })).toBeEnabled();
  });
});
