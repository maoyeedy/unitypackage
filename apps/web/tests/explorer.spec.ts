import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/static/archives/Polytope_URP.unitypackage');

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
    await page.getByPlaceholder('Search files by name or path').fill('xyznotexist');
    await expect(recordCount).toContainText('0 visible records');
  });

  test('clearing search restores all records', async ({ page }) => {
    const recordCount = page.getByRole('region', { name: 'Package explorer' }).getByText(/\d+ visible records/);
    const initial = await recordCount.textContent();
    await page.getByPlaceholder('Search files by name or path').fill('xyznotexist');
    await expect(recordCount).toContainText('0 visible records');
    await page.getByPlaceholder('Search files by name or path').clear();
    await expect(recordCount).toHaveText(initial ?? '');
  });

  test('Extension grouping replaces tree with extension group headers', async ({ page }) => {
    await page.getByRole('button', { name: 'Extension', exact: true }).click();
    await expect(page.getByRole('tree', { name: 'Package file tree' })).not.toBeVisible();
    const explorerPanel = page.getByRole('region', { name: 'Package explorer' });
    await expect(explorerPanel.getByRole('heading', { level: 3 }).first()).toBeVisible();
  });

  test('Tree grouping restores the file tree', async ({ page }) => {
    await page.getByRole('button', { name: 'Extension', exact: true }).click();
    await page.getByRole('button', { name: 'Tree', exact: true }).click();
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
    await expect(toolbar.getByRole('button', { name: 'Invert selection' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Select by extension', exact: true })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Stage for pack' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Selected ZIP' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'All ZIP' })).toBeVisible();
    // We expect 7 buttons: Sort direction, Clear, Invert, Select by extension, Stage, Selected ZIP, All ZIP
    await expect(toolbar.getByRole('button')).toHaveCount(7);
  });

  test.describe('Show preview records setting', () => {
    test.beforeEach(async ({ page }) => {
      await page.getByText('Display options').click();
    });

    test('preview rows are hidden by default in tree view', async ({ page }) => {
      const previewCheckbox = page.getByRole('checkbox', { name: 'Show preview records' });
      await expect(previewCheckbox).not.toBeChecked();
      const tree = page.getByRole('tree', { name: 'Package file tree' });
      // No treeitem should show a .preview.png filename when the toggle is off
      const previewItems = tree.locator('[role="treeitem"]').filter({ hasText: /\.preview\.png/ });
      await expect(previewItems.first()).not.toBeVisible();
    });

    test('preview rows appear in tree view when Show preview records is on', async ({ page }) => {
      const previewCheckbox = page.getByRole('checkbox', { name: 'Show preview records' });
      await previewCheckbox.check();
      await expect(previewCheckbox).toBeChecked();
      // Filter to preview.png to bring them into viewport
      await page.getByPlaceholder('Search files by name or path').fill('.preview.png');
      const tree = page.getByRole('tree', { name: 'Package file tree' });
      // At least one preview row should now be visible
      const previewItems = tree.locator('[role="treeitem"]').filter({ hasText: /\.preview\.png/ });
      await expect(previewItems.first()).toBeVisible();
    });

    test('searching .preview.png shows 0 visible records when Show preview records is off', async ({ page }) => {
      // Previews hidden by default -- searching for them should yield 0 visible records
      const recordCount = page.getByRole('region', { name: 'Package explorer' }).getByText(/\d+ visible records/);
      await page.getByPlaceholder('Search files by name or path').fill('.preview.png');
      await expect(recordCount).toContainText('0 visible records');
    });

    test('searching .preview.png shows records when Show preview records is on', async ({ page }) => {
      const previewCheckbox = page.getByRole('checkbox', { name: 'Show preview records' });
      await previewCheckbox.check();
      const recordCount = page.getByRole('region', { name: 'Package explorer' }).getByText(/\d+ visible records/);
      await page.getByPlaceholder('Search files by name or path').fill('.preview.png');
      // Records should now be visible (fixture has 82 preview records)
      await expect(recordCount).not.toContainText('0 visible records');
    });

    test('hiding preview rows clears selected preview records', async ({ page }) => {
      const previewCheckbox = page.getByRole('checkbox', { name: 'Show preview records' });
      await previewCheckbox.check();
      await page.getByPlaceholder('Search files by name or path').fill('.preview.png');
      await page.getByRole('checkbox', { name: /^Select .*\.preview\.png$/, disabled: false }).first().click();
      await expect(page.getByRole('button', { name: 'Clear selection' })).toBeEnabled();

      await previewCheckbox.uncheck();

      await expect(page.getByRole('button', { name: 'Clear selection' })).toBeDisabled();
      await previewCheckbox.check();
      await expect(page.getByRole('button', { name: 'Clear selection' })).toBeDisabled();
    });
  });

  test.describe('Include .meta with assets setting', () => {
    test.beforeEach(async ({ page }) => {
      await page.getByText('Display options').click();
    });

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
      await page.getByRole('button', { name: 'Extension', exact: true }).click();
      const explorerPanel = page.getByRole('region', { name: 'Package explorer' });
      // With setting off (default), there should be no "META" extension group header
      await expect(explorerPanel.getByRole('heading', { level: 3, name: 'meta' })).not.toBeVisible();
    });

    test('meta extension group appears when setting is on', async ({ page }) => {
      const metaCheckbox = page.getByRole('checkbox', { name: 'Include .meta with assets' });
      await metaCheckbox.check();
      // Filter to .meta files to bring it to the top/viewport
      await page.getByPlaceholder('Search files by name or path').fill('.meta');
      // Switch to extension grouping
      await page.getByRole('button', { name: 'Extension', exact: true }).click();
      const explorerPanel = page.getByRole('region', { name: 'Package explorer' });
      // With setting on, the "meta" extension group header should appear
      await expect(explorerPanel.getByRole('heading', { level: 3, name: 'meta' })).toBeVisible();
    });

    test('hiding meta rows clears selected meta records', async ({ page }) => {
      const metaCheckbox = page.getByRole('checkbox', { name: 'Include .meta with assets' });
      await metaCheckbox.check();
      await page.getByPlaceholder('Search files by name or path').fill('.meta');
      await page.locator('.file-row').first().getByRole('checkbox', { disabled: false }).click();
      await expect(page.getByRole('button', { name: 'Clear selection' })).toBeEnabled();

      await metaCheckbox.uncheck();

      await expect(page.getByRole('button', { name: 'Clear selection' })).toBeDisabled();
      await metaCheckbox.check();
      await expect(page.getByRole('button', { name: 'Clear selection' })).toBeDisabled();
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
      await page.getByPlaceholder('Search files by name or path').fill('Ground_Layer_01.terrainlayer');
      const assetRow = page.locator('.file-row').filter({
        has: page.locator('.file-name').filter({ hasText: /^Ground_Layer_01\.terrainlayer$/ }),
      }).first();
      await assetRow.click();
      // Click the preview download button
      const previewPanel = page.getByRole('complementary', { name: 'Preview and metadata' });
      const downloadPromise = page.waitForEvent('download');
      await previewPanel.getByRole('button', { name: /^Download/ }).click();
      const download = await downloadPromise;
      // When an asset has a meta sibling, the preview download should be a ZIP
      expect(download.suggestedFilename()).toMatch(/\.zip$/);
    });
  });

  test.describe('keyboard navigation and selection power', () => {
    test('arrow key navigation and selection in tree view', async ({ page }) => {
      const tree = page.getByRole('tree', { name: 'Package file tree' });

      // Click the first file row to focus and activate it
      const fileRow = tree.locator('.file-row').first();
      await fileRow.click();

      const firstId = await fileRow.getAttribute('id');
      let activeId = await tree.getAttribute('aria-activedescendant');
      expect(activeId).toBe(firstId);

      // Press ArrowDown to move focus to the next visible row
      await tree.press('ArrowDown');

      activeId = await tree.getAttribute('aria-activedescendant');
      expect(activeId).not.toBe(firstId);

      // Press Space to toggle selection
      await tree.press(' ');

      // Shift+ArrowDown range selection
      await tree.press('Shift+ArrowDown');

      const selectedCountText = page.getByText(/selected/);
      await expect(selectedCountText).toBeVisible();

      // Ctrl+A selection select only filtered visible records
      await tree.press('Control+A');
      const visibleRecordsText = await page.getByText(/visible records/).textContent();
      const match = visibleRecordsText?.match(/(\d+) visible records/);
      const visibleCount = match ? parseInt(match[1] ?? '0', 10) : 0;
      await expect(page.getByText(`${visibleCount} selected`)).toBeVisible();
    });

    test('arrow key navigation in extension grouping list', async ({ page }) => {
      await page.getByRole('button', { name: 'Extension', exact: true }).click();

      const extList = page.getByRole('tree', { name: 'Package file extensions' });
      await extList.focus();

      await extList.press('ArrowDown');
      let activeId = await extList.getAttribute('aria-activedescendant');
      expect(activeId).toContain('hdr-');

      await extList.press('ArrowDown');
      activeId = await extList.getAttribute('aria-activedescendant');
      expect(activeId).not.toContain('hdr-');
    });

    test('Invert selection toggles every filtered visible record', async ({ page }) => {
      const firstCheckbox = page.locator('.file-row').first().getByRole('checkbox');
      await firstCheckbox.click();
      await expect(page.getByText(/selected/)).toContainText('1 selected');

      await page.getByRole('button', { name: 'Invert selection' }).click();

      await expect(firstCheckbox).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByText(/selected/)).toBeVisible();
      await expect(page.getByText(/selected/)).not.toContainText('1 selected');
    });

    test('Select by extension opens a picker and selects by extension', async ({ page }) => {
      await page.getByRole('button', { name: 'Select by extension', exact: true }).click();

      const pickerOption = page.locator('.ext-picker-dropdown button').first();
      await pickerOption.click();

      await expect(page.getByText(/selected/)).toBeVisible();
    });

    test('keyboard-only end-to-end workflow', async ({ page }) => {
      // 1. Navigate explorer with arrows
      const tree = page.getByRole('tree', { name: 'Package file tree' });
      // Click the first file row to focus
      await tree.locator('.file-row').first().click();

      // Press ArrowDown to navigate
      await tree.press('ArrowDown');
      await tree.press('ArrowDown');

      // 2. Range-select with Shift+Arrow
      await tree.press('Shift+ArrowDown');
      await tree.press('Shift+ArrowDown');

      // Verify selection count is visible
      await expect(page.getByText(/selected/)).toBeVisible();

      // 3. Open and dismiss the diagnostics drawer
      const findingsBtn = page.getByRole('button', { name: 'Toggle diagnostics drawer' });
      await expect(findingsBtn).toBeVisible();
      await findingsBtn.focus();
      await page.keyboard.press('Enter');

      // Verify diagnostics drawer is visible
      const drawer = page.getByRole('complementary', { name: 'Diagnostics' });
      await expect(drawer).toBeVisible();

      // Dismiss drawer with Escape
      await page.keyboard.press('Escape');
      await expect(drawer).not.toBeVisible();

      // 4. Use find-in-preview
      // First click/focus a textual file row to open its preview
      const csFileRow = tree.locator('.file-row').filter({ hasText: /\.cs/ }).first();
      await csFileRow.click();

      const textFrame = page.locator('.text-frame').first();
      await expect(textFrame).toBeVisible();
      await textFrame.focus();

      // Press Control+F to open find bar
      await page.keyboard.press('Control+f');

      const findInput = page.getByLabel('Find in preview');
      await expect(findInput).toBeVisible();
      await findInput.fill('class');
      await page.keyboard.press('Enter');

      // Dismiss find bar with Escape
      await page.keyboard.press('Escape');
      await expect(findInput).not.toBeVisible();

      // 5. Trigger Selected ZIP download using keyboard
      const downloadPromise = page.waitForEvent('download');
      const selectedZipBtn = page.getByRole('button', { name: 'Selected ZIP' });
      await expect(selectedZipBtn).toBeEnabled();
      await selectedZipBtn.focus();
      await page.keyboard.press('Enter');
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe('selected_files.zip');
    });
  });
});
