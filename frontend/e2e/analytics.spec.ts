import { test, expect } from '@playwright/test';

test.describe('Analytics View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/analytics');
  });

  test('loads analytics page', async ({ page }) => {
    await expect(page.getByText(/analytics|shift|summary/i).first()).toBeVisible();
  });

  test('shows shift summary', async ({ page }) => {
    await expect(page.getByText(/shift summary/i).first()).toBeVisible();
  });

  test('shows threshold violations', async ({ page }) => {
    await expect(page.getByText(/threshold violation/i).first()).toBeVisible();
  });

  test('shows energy report', async ({ page }) => {
    await expect(page.getByText(/energy/i).first()).toBeVisible();
  });
});
