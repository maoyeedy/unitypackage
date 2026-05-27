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

  test('meta rows are hidden by default and visible when enabled', async ({ page }) => {
    await page.getByText('Display options').click();
    const metaCheckbox = page.getByRole('checkbox', { name: 'Show .meta files' });
    await expect(metaCheckbox).not.toBeChecked();

    await page.getByPlaceholder('Search files by name or path').fill('.meta');
    const fileCount = page.getByRole('region', { name: 'Package explorer' }).getByText(/^\d+ visible files$/);
    await expect(fileCount).toHaveText('0 visible files');

    await metaCheckbox.check();
    await expect(fileCount).not.toHaveText('0 visible files');
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
});
