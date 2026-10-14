import { test, expect } from '@playwright/test';

test.describe('Machine View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/machine/CNC-03');
    await expect(page.getByRole('heading', { name: 'CNC Mill 03' })).toBeVisible();
  });

  test('shows critical badge and action required', async ({ page }) => {
    await expect(page.locator('.inc-head').getByText('critical')).toBeVisible();
    await expect(page.locator('.inc-head').getByText('Action required')).toBeVisible();
  });

  test('shows all 8 tabs', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Monitoring' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Trends' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Threshold' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Investigate' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Actions' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Audit' })).toBeVisible();
  });

  test('monitoring tab shows power values', async ({ page }) => {
    await expect(page.getByText('ACTUAL POWER')).toBeVisible();
    await expect(page.getByText('600.9 kW')).toBeVisible();
    await expect(page.getByText('EXPECTED POWER')).toBeVisible();
    await expect(page.getByText('48.0 kW')).toBeVisible();
    await expect(page.getByText('DEVIATION')).toBeVisible();
    await expect(page.getByText('+1152.1%')).toBeVisible();
  });

  test('trends tab shows chart', async ({ page }) => {
    await page.getByRole('button', { name: 'Trends' }).click();
    await expect(page.getByText('Power Trends')).toBeVisible();
    // Recharts renders SVG
    await expect(page.locator('svg').first()).toBeVisible();
  });

  test('threshold tab shows configuration', async ({ page }) => {
    await page.getByRole('button', { name: 'Threshold' }).click();
    await expect(page.getByText(/Threshold ·/)).toBeVisible();
    await expect(page.locator('table.thr')).toBeVisible();
  });

  test('audit tab shows placeholder or log entries', async ({ page }) => {
    await page.getByRole('button', { name: 'Audit' }).click();
    await expect(page.getByRole('heading', { name: 'Audit trail' })).toBeVisible();
  });

  test('has back link to plant', async ({ page }) => {
    await page.getByText('← Plant').click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Pune Plant' })).toBeVisible();
  });
});
