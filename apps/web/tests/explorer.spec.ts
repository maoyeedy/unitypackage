import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/static/archives/Polytope_URP.unitypackage');

test.describe('explorer interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Open Unity package').setInputFiles(fixturePath);
    await expect(page.getByText(/Parsed \d+ files/)).toBeVisible({ timeout: 15_000 });
  });

  test('search filters and restores visible files', async ({ page }) => {
    const fileCount = page.getByRole('region', { name: 'Package explorer' }).getByText(/\d+ visible files/);
    const initial = await fileCount.textContent();
    expect(initial).toMatch(/\d+ visible files/);

    await page.getByPlaceholder('Search files by name or path').fill('xyznotexist');
    await expect(fileCount).toContainText('0 visible files');

    await page.getByPlaceholder('Search files by name or path').clear();
    await expect(fileCount).toHaveText(initial ?? '');
  });

  test('extension grouping can replace and restore the tree', async ({ page }) => {
    await page.getByRole('button', { name: 'Extension', exact: true }).click();
    await expect(page.getByRole('tree', { name: 'Package file tree' })).not.toBeVisible();
    await expect(page.getByRole('tree', { name: 'Package file extensions' })).toBeVisible();

    await page.getByRole('button', { name: 'Tree', exact: true }).click();
    await expect(page.getByRole('tree', { name: 'Package file tree' })).toBeVisible();
  });

  test('selection buttons update with selected files', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Clear selection' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Selected ZIP' })).toBeDisabled();

    await page.getByRole('checkbox', { name: /^Select/, disabled: false }).first().click();

    await expect(page.getByRole('button', { name: 'Clear selection' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Selected ZIP' })).toBeEnabled();

    await page.getByRole('button', { name: 'Clear selection' }).click();
    await expect(page.getByRole('button', { name: 'Clear selection' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Selected ZIP' })).toBeDisabled();
  });

  test('extract toolbar keeps power selection tools but no pack action', async ({ page }) => {
    const toolbar = page.getByRole('region', { name: 'Package explorer' }).locator('.button-row');
    await expect(toolbar.getByRole('button', { name: 'Clear selection' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Invert selection' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Select by extension', exact: true })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Selected ZIP' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'All ZIP' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Stage for pack' })).not.toBeVisible();
  });

  test('Unity preview records are not exposed in the explorer', async ({ page }) => {
    await page.getByPlaceholder('Search files by name or path').fill('.preview.png');
    const fileCount = page.getByRole('region', { name: 'Package explorer' }).getByText(/\d+ visible files/);
    await expect(fileCount).toContainText('0 visible files');
  });

  test('meta rows stay hidden from browsing and search', async ({ page }) => {
    await page.getByPlaceholder('Search files by name or path').fill('.meta');
    const fileCount = page.getByRole('region', { name: 'Package explorer' }).getByText(/^\d+ visible files$/);
    await expect(fileCount).toHaveText('0 visible files');
  });

  test('meta sidecar renders immediate text preview', async ({ page }) => {
    const preview = page.getByRole('complementary', { name: 'Preview and metadata' });
    await expect(preview.getByRole('group', { name: 'Preview source' })).toBeVisible();

    await preview.getByRole('button', { name: '.meta' }).click();
    // Meta is now immediate text (no deferred "Load preview" button)
    await expect(preview.locator('code')).toContainText('fileFormatVersion');
    await expect(preview.getByText('Details', { exact: true })).not.toBeVisible();

    await preview.getByRole('button', { name: 'Asset', exact: true }).click();
    await expect(preview.getByText('Details', { exact: true })).toBeVisible();
  });

  test('ZIP meta sidecar option remains available without meta display controls', async ({ page }) => {
    await expect(page.getByRole('checkbox', { name: 'Show .meta files' })).not.toBeVisible();
    await page.getByText('ZIP options').click();
    const zipMetaCheckbox = page.getByRole('checkbox', { name: 'Include .meta sidecars in ZIP' });
    await expect(zipMetaCheckbox).toBeChecked();

    await zipMetaCheckbox.uncheck();
    await expect(zipMetaCheckbox).not.toBeChecked();
  });

  test('Selected ZIP download filename is selected_files.zip', async ({ page }) => {
    await page.getByRole('checkbox', { name: /^Select/, disabled: false }).first().click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Selected ZIP' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('selected_files.zip');
  });

  test('keyboard navigation and range selection still work', async ({ page }) => {
    const tree = page.getByRole('tree', { name: 'Package file tree' });
    await tree.locator('.file-row').first().click();

    await tree.press('ArrowDown');
    await tree.press(' ');
    await tree.press('Shift+ArrowDown');

    await expect(page.getByText(/selected/)).toBeVisible();
  });

  test('All ZIP download filename is all_files.zip', async ({ page }) => {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'All ZIP' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('all_files.zip');
  });

  test('large TerrainData binary asset shows collapsed preview and metadata', async ({ page }) => {
    const preview = page.getByRole('complementary', { name: 'Preview and metadata' });

    await page.getByPlaceholder('Search files by name or path').fill('TerrainData_6dc76592');
    const fileRow = page.getByRole('treeitem').filter({ hasText: 'TerrainData_6dc76592' });
    await expect(fileRow.first()).toBeVisible({ timeout: 3_000 });

    const start = performance.now();
    await fileRow.first().click();
    await expect(preview.getByText('GUID', { exact: true })).toBeVisible({ timeout: 10_000 });
    const elapsed = performance.now() - start;

    await expect(preview.locator('.preview-frame')).not.toBeVisible();
    await expect(preview.getByText('Details', { exact: true })).toBeVisible();
    expect(elapsed).toBeLessThan(2000);
  });

  test('small terrainlayer asset shows text preview and metadata', async ({ page }) => {
    const preview = page.getByRole('complementary', { name: 'Preview and metadata' });

    await page.getByPlaceholder('Search files by name or path').fill('Ground_Layer_01.terrainlayer');
    const fileRow = page.getByRole('treeitem').filter({ hasText: 'Ground_Layer_01.terrainlayer' });
    await expect(fileRow.first()).toBeVisible({ timeout: 3_000 });

    const start = performance.now();
    await fileRow.first().click();
    await expect(preview.getByText('GUID', { exact: true })).toBeVisible({ timeout: 5_000 });
    const elapsed = performance.now() - start;

    await expect(preview.locator('.preview-frame.text-frame')).toBeVisible();
    await expect(preview.getByText('Details', { exact: true })).toBeVisible();
    expect(elapsed).toBeLessThan(1000);
  });
});
