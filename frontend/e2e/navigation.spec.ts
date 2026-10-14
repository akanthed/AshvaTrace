import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('clicking brand returns to plant overview', async ({ page }) => {
    await page.goto('/machine/CNC-01');
    await expect(page.getByRole('heading', { name: 'CNC Mill 01' })).toBeVisible();
    await page.getByRole('button', { name: /AshvaTrace/ }).click();
    await expect(page).toHaveURL('/');
  });

  test('navigates from plant to machine detail via sidebar', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /CNC-01/ }).click();
    await expect(page).toHaveURL('/machine/CNC-01');
  });

  test('navigates from machine back to plant', async ({ page }) => {
    await page.goto('/machine/CNC-01');
    await expect(page.getByRole('heading', { name: 'CNC Mill 01' })).toBeVisible();
    await page.getByText('← Plant').click();
    await expect(page).toHaveURL('/');
  });

  test('shows shift and date info in plant overview header', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/Shift A/)).toBeVisible();
  });

  test('shows live clock in top bar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.clock')).toBeVisible();
  });
});
