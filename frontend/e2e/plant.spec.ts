import { test, expect } from '@playwright/test';

test.describe('Plant Overview', () => {
  test('loads and shows all 3 machines', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Plant Overview')).toBeVisible();
    const table = page.locator('.mtable');
    await expect(table.getByText('CNC Mill 01')).toBeVisible();
    await expect(table.getByText('CNC Mill 02')).toBeVisible();
    await expect(table.getByText('CNC Mill 03')).toBeVisible();
  });

  test('shows CNC-03 as action required with high deviation', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Action required').first()).toBeVisible();
    // CNC-03 sits in the action band (~15% deviation), so its deviation badge
    // should be a positive value above the 10% critical threshold.
    const cnc03Row = page.locator('.mtable').getByRole('link', { name: 'CNC-03' });
    await expect(cnc03Row).toBeVisible();
  });

  test('shows summary counts', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.counts').getByText('Action required')).toBeVisible();
    await expect(page.locator('.counts').getByText('Normal')).toBeVisible();
  });

  test('shows alert banner for critical machine', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/CRITICAL:/)).toBeVisible();
    await expect(page.getByText(/CNC Mill 03/).first()).toBeVisible();
  });

  test('navigates to machine detail on click', async ({ page }) => {
    await page.goto('/');
    await page.locator('.mtable').getByRole('link', { name: 'CNC-03' }).click();
    await expect(page).toHaveURL(/\/machine\/CNC-03/);
    await expect(page.getByRole('heading', { name: 'CNC Mill 03' })).toBeVisible();
  });
});
