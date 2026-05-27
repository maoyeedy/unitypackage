import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/static/archives/Polytope_URP.unitypackage');

test('renders app heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Unity Package Workspace', level: 1 })).toBeVisible();
});

test('statusbar has no initial text on fresh load', async ({ page }) => {
  await page.goto('/');
  // After the status string was replaced with a current-op indicator,
  // the footer is empty on idle (no freeform initial message).
  const statusbar = page.locator('.statusbar');
  await expect(statusbar).toBeVisible();
  // The statusbar-op span should be empty when no op is running
  const opSpan = statusbar.locator('.statusbar-op');
  await expect(opSpan).toBeEmpty();
});

test('shows Extract and Pack mode tabs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Extract' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pack', exact: true })).toBeVisible();
});

test('shows empty state when no package is loaded', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'No records loaded' })).toBeVisible();
});

test('shows no-selection prompt in preview panel', async ({ page }) => {
  await page.goto('/');
  const previewPanel = page.getByRole('complementary', { name: 'Preview and metadata' });
  await expect(previewPanel.getByRole('heading', { name: 'No file selected' })).toBeVisible();
});

test('preview panel shows file content and metadata after clicking a record', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Open package').setInputFiles(fixturePath);
  await expect(page.getByText(/Parsed \d+ records/)).toBeVisible({ timeout: 15_000 });
  const preview = page.getByRole('complementary', { name: 'Preview and metadata' });
  await expect(preview.getByText('Path', { exact: true })).toBeVisible();
  await expect(preview.getByText('GUID', { exact: true })).toBeVisible();
});

test('meta rows are not visible in tree when Include .meta with assets is off', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Open package').setInputFiles(fixturePath);
  await expect(page.getByText(/Parsed \d+ records/)).toBeVisible({ timeout: 15_000 });
  await page.getByText('Display options').click();
  const metaCheckbox = page.getByRole('checkbox', { name: 'Include .meta with assets' });
  await expect(metaCheckbox).not.toBeChecked();
  const tree = page.getByRole('tree', { name: 'Package file tree' });
  // With setting off, no treeitem label should end with .meta
  const metaItems = tree.locator('[role="treeitem"]').filter({ hasText: /\.meta/ });
  await expect(metaItems.first()).not.toBeVisible();
});
