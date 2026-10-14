import { test, expect } from '@playwright/test';

test.describe('Incident Investigation Flow', () => {
  test('investigate tab links to the open incident', async ({ page }) => {
    await page.goto('/machine/CNC-03');
    await expect(page.getByRole('heading', { name: 'CNC Mill 03' })).toBeVisible();
    await page.getByRole('button', { name: 'Investigate' }).click();
    await expect(page.getByText('Open incident')).toBeVisible();
  });

  test('actions tab is accessible', async ({ page }) => {
    await page.goto('/machine/CNC-03');
    await expect(page.getByRole('heading', { name: 'CNC Mill 03' })).toBeVisible();
    await page.getByRole('button', { name: 'Actions' }).click();
    await expect(page.getByRole('heading', { name: 'Interventions' })).toBeVisible();
  });

  test('verify tab is accessible', async ({ page }) => {
    await page.goto('/machine/CNC-03');
    await expect(page.getByRole('heading', { name: 'CNC Mill 03' })).toBeVisible();
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('heading', { name: 'Verification' })).toBeVisible();
  });

  test('opening the incident shows the AI investigation entry point', async ({ page }) => {
    await page.goto('/machine/CNC-03');
    await page.getByRole('button', { name: 'Investigate' }).click();
    await page.getByText('Open incident').click();
    await expect(page.getByText('Run investigation')).toBeVisible();
  });
});
