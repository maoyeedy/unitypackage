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
    await page.getByPlaceholder('Filter path or GUID').fill('xyznotexist');
    await expect(recordCount).toContainText('0 visible records');
  });

  test('clearing search restores all records', async ({ page }) => {
    const recordCount = page.getByRole('region', { name: 'Package explorer' }).getByText(/\d+ visible records/);
    const initial = await recordCount.textContent();
    await page.getByPlaceholder('Filter path or GUID').fill('xyznotexist');
    await expect(recordCount).toContainText('0 visible records');
    await page.getByPlaceholder('Filter path or GUID').clear();
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

  test('Extract toolbar has exactly the expected buttons', async ({ page }) => {
    const toolbar = page.getByRole('region', { name: 'Package explorer' }).locator('.button-row');
    await expect(toolbar.getByRole('button', { name: 'Clear selection' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Stage for pack' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Selected ZIP' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'All ZIP' })).toBeVisible();
    await expect(toolbar.getByRole('button')).toHaveCount(4);
  });

  test.describe('Include .meta with assets setting', () => {
    test('meta rows are hidden in tree view when setting is off (default)', async ({ page }) => {
      // The setting defaults to unchecked -- meta rows should not appear in the tree
      const metaCheckbox = page.getByRole('checkbox', { name: 'Include .meta with assets' });
      await expect(metaCheckbox).not.toBeChecked();
      const tree = page.getByRole('tree', { name: 'Package file tree' });
      // No visible treeitem should show a .meta filename
      const metaItems = tree.getByRole('treeitem').filter({ hasText: /\.meta$/ });
      await expect(metaItems.first()).not.toBeVisible();
    });

    test('meta rows appear in tree view when setting is on', async ({ page }) => {
      const metaCheckbox = page.getByRole('checkbox', { name: 'Include .meta with assets' });
      await expect(metaCheckbox).not.toBeChecked();
      await metaCheckbox.check();
      await expect(metaCheckbox).toBeChecked();
      const tree = page.getByRole('tree', { name: 'Package file tree' });
      // At least one .meta row should now be visible
      const metaItems = tree.locator('[role="treeitem"]').filter({ hasText: /\.meta/ });
      await expect(metaItems.first()).toBeVisible();
    });

    test('meta extension group disappears when setting is off', async ({ page }) => {
      // Switch to extension grouping
      await page.getByRole('button', { name: 'Extension' }).click();
      const explorerPanel = page.getByRole('region', { name: 'Package explorer' });
      // With setting off (default), there should be no "META" extension group header
      await expect(explorerPanel.getByRole('heading', { level: 3, name: 'meta' })).not.toBeVisible();
    });

    test('meta extension group appears when setting is on', async ({ page }) => {
      const metaCheckbox = page.getByRole('checkbox', { name: 'Include .meta with assets' });
      await metaCheckbox.check();
      // Switch to extension grouping
      await page.getByRole('button', { name: 'Extension' }).click();
      const explorerPanel = page.getByRole('region', { name: 'Package explorer' });
      // With setting on, the "meta" extension group header should appear
      await expect(explorerPanel.getByRole('heading', { level: 3, name: 'meta' })).toBeVisible();
    });

    test('Selected ZIP download filename is selected_files.zip', async ({ page }) => {
      // Enable meta sidecars
      const metaCheckbox = page.getByRole('checkbox', { name: 'Include .meta with assets' });
      await metaCheckbox.check();
      // Select the first asset checkbox
      await page.getByRole('checkbox', { name: /^Select/, disabled: false }).first().click();
      // Listen for download and trigger it
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Selected ZIP' }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe('selected_files.zip');
    });

    test('preview download with sidecars enabled downloads a ZIP', async ({ page }) => {
      // Enable meta sidecars
      const metaCheckbox = page.getByRole('checkbox', { name: 'Include .meta with assets' });
      await metaCheckbox.check();
      // Click a non-meta asset row to make it active in preview
      const tree = page.getByRole('tree', { name: 'Package file tree' });
      // Find a treeitem that does NOT end with .meta -- click the first one
      const assetItem = tree.locator('[role="treeitem"]').filter({ hasNot: page.locator('.file-name').filter({ hasText: /\.meta$/ }) }).first();
      await assetItem.click();
      // Click the preview download button
      const previewPanel = page.getByRole('complementary', { name: 'Preview and metadata' });
      const downloadPromise = page.waitForEvent('download');
      await previewPanel.getByRole('button', { name: /^Download/ }).click();
      const download = await downloadPromise;
      // When an asset has a meta sibling, the preview download should be a ZIP
      expect(download.suggestedFilename()).toMatch(/\.zip$/);
    });
  });
});
