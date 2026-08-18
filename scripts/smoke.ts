/**
 * Browser smoke test: drives the built app in Chromium and checks that the
 * things the unit tests cannot see actually work — data fetching, lazy season
 * loading, navigation, tooltips, and scene stability across navigation.
 *
 * Run against a preview server:
 *   npm run build && npm run preview -- --port 4173 &
 *   npm run test:smoke
 *
 * Kept out of `npm test` so the unit suite stays browser-free.
 */
import { chromium, type Browser, type Page } from 'playwright';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:4173/magdalenian/';

const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

function check(name: string, ok: boolean, detail = ''): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Clicks a nav entry whose trimmed text matches exactly. */
async function clickExact(page: Page, selector: string, text: string): Promise<void> {
  await page.locator(selector).filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).first().click();
  await page.waitForTimeout(150);
}

async function sceneText(page: Page): Promise<string> {
  return (await page.locator('#main-display').innerText()).trim();
}

async function run(browser: Browser): Promise<void> {
  const page = await browser.newPage();

  const failedRequests: string[] = [];
  const consoleErrors: string[] = [];
  page.on('requestfailed', (r) => failedRequests.push(r.url()));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  const requested: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/data/')) requested.push(r.url().split('/').pop() ?? '');
  });

  await page.goto(BASE, { waitUntil: 'networkidle' });

  check('app shell becomes visible', await page.locator('#simulation-container').isVisible());
  check(
    'no failed requests',
    failedRequests.length === 0,
    failedRequests.slice(0, 3).join(', '),
  );
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

  // Default view is day 1 / loc0 / hour 9, which is an authored event.
  const opening = await sceneText(page);
  check('opening scene renders day 1', opening.includes('Day 1'), opening.slice(0, 60));
  check('location nav is populated', (await page.locator('.location-button').count()) === 22);

  const authored = opening.toLowerCase();
  check(
    'day 1 hour 9 shows authored content',
    authored.includes('cave mouth') && opening.length > 200,
  );

  // Only the summer chunk should have loaded so far.
  check(
    'loads only the summer season chunk upfront',
    requested.includes('year-detail-summer.json') &&
      !requested.some((f) => /autumn|winter|spring/.test(f)),
    requested.join(', '),
  );

  // Navigate to winter, which must pull a second chunk.
  await clickExact(page, '#time-nav-container h3', 'Winter');
  await page.waitForTimeout(600);
  check(
    'lazy-loads the winter chunk on demand',
    requested.includes('year-detail-winter.json'),
    requested.join(', '),
  );

  // A hunting ground in deep winter, at midday.
  await page.locator('.location-button', { hasText: 'The Whispering Valley' }).click();
  await clickExact(page, '#time-nav-container h4', 'Midwinter');
  await page.waitForTimeout(300);
  const winterScene = await sceneText(page);
  check('winter scene renders', winterScene.includes('Whispering Valley'), winterScene.slice(0, 50));
  check('winter scene is seasonally labelled', winterScene.includes('Winter'));

  // Determinism: leave and come back, the scene must be identical.
  await page.locator('.location-button', { hasText: 'The Cave Mouth' }).click();
  await page.waitForTimeout(200);
  await page.locator('.location-button', { hasText: 'The Whispering Valley' }).click();
  await page.waitForTimeout(200);
  check('scene is stable across navigation', (await sceneText(page)) === winterScene);

  // Tooltips on character names.
  const names = page.locator('.character-name');
  const nameCount = await names.count();
  check('generated scene names characters', nameCount > 0, `${nameCount} names`);
  if (nameCount > 0) {
    await names.first().hover();
    await page.waitForTimeout(150);
    const tooltip = page.locator('#tooltip');
    check('character tooltip appears on hover', await tooltip.isVisible());
    check('tooltip has a description', (await tooltip.innerText()).trim().length > 10);
  }

  // Hour navigation changes the scene.
  const before = await sceneText(page);
  await clickExact(page, '#time-nav-container .nav-item', '3');
  await page.waitForTimeout(300);
  check('changing the hour changes the scene', (await sceneText(page)) !== before);

  await page.close();
}

/** URL routing, keyboard navigation and the character index. */
async function runNavigation(browser: Browser): Promise<void> {
  const page = await browser.newPage();

  // A deep link should land exactly where it points.
  await page.goto(`${BASE}#/d200/h13/loc22`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  let scene = await sceneText(page);
  check('deep link lands on the right day', scene.includes('Day 200'), scene.slice(0, 30));
  check('deep link lands on the right place', scene.includes('Whispering Valley'));

  // Arrow keys step the hour, and the URL follows.
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  check('right arrow steps the hour', page.url().endsWith('#/d200/h14/loc22'), page.url());

  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  check('down arrow steps the day', page.url().endsWith('#/d201/h14/loc22'), page.url());

  await page.keyboard.press(']');
  await page.waitForTimeout(300);
  check('bracket steps the location', !page.url().includes('loc22'), page.url());

  // Back should undo the last step.
  await page.goBack();
  await page.waitForTimeout(400);
  check('browser back returns to the previous scene', page.url().endsWith('#/d201/h14/loc22'), page.url());

  // Stepping back from midnight rolls into the previous day.
  await page.goto(`${BASE}#/d100/h0/loc0`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(300);
  check('hour rolls over into the previous day', page.url().endsWith('#/d99/h23/loc0'), page.url());

  // The character index.
  await page.locator('#open-index').click();
  await page.waitForTimeout(300);
  const index = await sceneText(page);
  check('character index opens', index.includes('The Band'), index.slice(0, 40));
  check('index lists the whole band', (await page.locator('.character-name').count()) >= 43);
  check('index shows kinship', index.toLowerCase().includes('mate of'));
  check('index groups households', index.includes('Household'));

  await page.locator('#close-index').click();
  await page.waitForTimeout(400);
  scene = await sceneText(page);
  check('index closes back to the scene', scene.includes('Day 99'), scene.slice(0, 30));

  // A nonsense hash should fall back rather than break.
  await page.goto(`${BASE}#/d999/h99/nowhere`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  check('bad hash falls back to a valid scene', (await sceneText(page)).includes('Day '));

  await page.close();
}

/**
 * The service worker only registers over HTTPS or on localhost, so this runs
 * against the preview server and then cuts the network to prove the precached
 * shell and data are genuinely served from cache.
 */
async function runOffline(browser: Browser): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(BASE, { waitUntil: 'networkidle' });

  const registered = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active);
  });
  check('service worker registers and activates', registered);

  // Give workbox a moment to finish writing the precache.
  await page.waitForTimeout(2500);

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const offlineText = await sceneText(page);
  check('app shell loads with the network cut', await page.locator('#simulation-container').isVisible());
  check('precached data renders offline', offlineText.includes('Day 1'), offlineText.slice(0, 40));

  await context.setOffline(false);
  await context.close();
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  await run(browser);
  await runNavigation(browser);
  await runOffline(browser);
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length > 0) process.exit(1);
