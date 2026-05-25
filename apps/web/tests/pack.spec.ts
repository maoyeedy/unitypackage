import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/static/editor-packed.unitypackage');

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
    await explorerPanel.getByRole('button', { name: 'Clear' }).click();
    await expect(explorerPanel).toContainText('0 future package entries staged');
  });
});
