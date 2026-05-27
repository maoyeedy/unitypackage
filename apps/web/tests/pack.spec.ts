import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/static/archives/Polytope_URP.unitypackage');

async function selectFileByName(page: import('@playwright/test').Page, fileName: string): Promise<void> {
  await page.getByPlaceholder('Search files by name or path').fill(fileName);
  const row = page.locator('.file-row').filter({
    has: page.locator('.file-name').filter({ hasText: new RegExp(`^${RegExp.escape(fileName)}$`) }),
  }).first();
  await row.getByRole('checkbox', { disabled: false }).click();
}

test.describe('pack mode', () => {
  test('Pack tab shows pack panel heading', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Pack', exact: true }).click();
    const explorerPanel = page.getByRole('region', { name: 'Package explorer' });
    await expect(explorerPanel.getByRole('heading', { name: 'Pack', level: 2, exact: true })).toBeVisible();
  });

  test('Extract tab returns to extract panel', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Pack', exact: true }).click();
    await page.getByRole('button', { name: 'Extract' }).click();
    const explorerPanel = page.getByRole('region', { name: 'Package explorer' });
    await expect(explorerPanel.getByRole('heading', { name: 'Extract', level: 2 })).toBeVisible();
  });

  test('Stage for pack switches to Pack mode with staged entries', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Open package').setInputFiles(fixturePath);
    await expect(page.getByText(/Parsed \d+ records/)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('checkbox', { name: /^Select/, disabled: false }).first().click();
    await page.getByRole('button', { name: 'Stage for pack' }).click();
    const explorerPanel = page.getByRole('region', { name: 'Package explorer' });
    await expect(explorerPanel.getByRole('heading', { name: 'Pack', level: 2, exact: true })).toBeVisible();
    await expect(explorerPanel).not.toContainText('0 future package entries staged');
  });

  test('Clear in Pack panel removes all staged items', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Open package').setInputFiles(fixturePath);
    await expect(page.getByText(/Parsed \d+ records/)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('checkbox', { name: /^Select/, disabled: false }).first().click();
    await page.getByRole('button', { name: 'Stage for pack' }).click();
    const explorerPanel = page.getByRole('region', { name: 'Package explorer' });
    await expect(explorerPanel).not.toContainText('0 future package entries staged');
    await explorerPanel.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(explorerPanel).toContainText('0 future package entries staged');
  });

  test('Drag and drop a file, edit its pathname, and export successfully', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Pack', exact: true }).click();

    const pngPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/static/texture.png');
    const fileBuffer = fs.readFileSync(pngPath);
    const base64Data = fileBuffer.toString('base64');
    const fileName = 'texture.png';

    await page.evaluate(async ({ base64, name }) => {
      const response = await fetch(`data:application/octet-stream;base64,${base64}`);
      const blob = await response.blob();
      const file = new File([blob], name, { type: 'image/png' });

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      const dropTarget = document.querySelector('.staged-list-container');
      if (!dropTarget) throw new Error('Drop target not found');

      const dragOverEvent = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      });
      dropTarget.dispatchEvent(dragOverEvent);

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      });
      dropTarget.dispatchEvent(dropEvent);
    }, { base64: base64Data, name: fileName });

    const stagedInput = page.locator('.staged-pathname-input');
    await expect(stagedInput).toBeVisible();
    await expect(stagedInput).toHaveValue('texture.png');

    await stagedInput.fill('Assets/Textures/new_texture.png');
    await expect(stagedInput).toHaveValue('Assets/Textures/new_texture.png');

    const exportBtn = page.getByRole('button', { name: 'Export .unitypackage' });
    await expect(exportBtn).toBeEnabled();

    await exportBtn.click();
    await expect(page.locator('.pack-status.success')).toBeVisible({ timeout: 15_000 });

    await page.locator('#export-filename').fill('changed-name.unitypackage');
    await expect(page.locator('.pack-status.success')).not.toBeVisible();
  });

  test('Stage records, export package, and verify round-trip parsing', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Open package').setInputFiles(fixturePath);
    await expect(page.getByText(/Parsed \d+ records/)).toBeVisible({ timeout: 15_000 });

    // Stage two valid assets (without preview files to keep validation ready)
    await selectFileByName(page, 'Ground_Layer_01.terrainlayer');
    await selectFileByName(page, 'Ground_Layer_02.terrainlayer');
    await page.getByRole('button', { name: 'Stage for pack' }).click();

    // Click Export and wait for download event
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export .unitypackage' }).click();
    const download = await downloadPromise;

    // Read download stream
    const tempPath = await download.path();
    expect(tempPath).not.toBeNull();
    const bytes = fs.readFileSync(tempPath!);
    expect(bytes.length).toBeGreaterThan(0);

    // Call parseUnityPackageEntries on the downloaded bytes in the test context
    const { parseUnityPackageEntries } = await import('unitypackage-core');
    const { entries } = parseUnityPackageEntries(bytes);

    // Verify round-trip parsing success
    expect(entries.length).toBe(2);

    // Verify GUIDs, pathnames, and contents match the selected assets
    const expectedPaths = [
      'Assets/Plugins/Polytope Studio/Lowpoly_Demos/Environment_Free/Helpers/Ground_Layer_01.terrainlayer',
      'Assets/Plugins/Polytope Studio/Lowpoly_Demos/Environment_Free/Helpers/Ground_Layer_02.terrainlayer'
    ];
    for (const pathStr of expectedPaths) {
      const parsed = entries.find(e => e.pathname === pathStr);
      expect(parsed).toBeDefined();
      expect(parsed?.guid).toHaveLength(32);
      expect(parsed?.asset).toBeDefined();
      expect(parsed?.asset!.length).toBeGreaterThan(0);
      expect(parsed?.meta).toBeDefined();
      expect(parsed?.meta!.length).toBeGreaterThan(0);
    }
  });
});
