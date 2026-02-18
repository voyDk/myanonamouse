import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import dotenv from 'dotenv';
import { chromium } from 'playwright';

dotenv.config({ quiet: true });

const DEFAULT_LOGIN_URL = 'https://www.myanonamouse.net/login.php?returnto=%2Fstore.php';
const DEFAULT_STORE_URL = 'https://www.myanonamouse.net/store.php';

function parseBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function parseIntStrict(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberFromText(value) {
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  if (!digits) {
    return null;
  }
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function randomInt(min, max) {
  if (max <= min) {
    return min;
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildConfig() {
  const args = new Set(process.argv.slice(2));
  const snapshotOnly = args.has('--snapshot') || parseBool(process.env.MAM_SNAPSHOT_ONLY, false);
  const jsonOutput = args.has('--json') || parseBool(process.env.MAM_JSON_OUTPUT, false);
  const applyRequested = args.has('--apply') || parseBool(process.env.MAM_APPLY, false);
  const apply = snapshotOnly ? false : applyRequested;
  const headed = args.has('--headed') || parseBool(process.env.MAM_HEADLESS, false) === false;

  return {
    email: process.env.MAM_EMAIL || process.env.MAM_USERNAME || '',
    password: process.env.MAM_PASSWORD || '',
    snapshotOnly,
    jsonOutput,
    loginUrl: process.env.MAM_LOGIN_URL || DEFAULT_LOGIN_URL,
    storeUrl: process.env.MAM_STORE_URL || DEFAULT_STORE_URL,
    apply,
    headless: !headed,
    bonusCap: parseIntStrict(process.env.MAM_BONUS_CAP, 99999),
    bonusThreshold: parseIntStrict(process.env.MAM_BONUS_THRESHOLD, 98000),
    bonusTarget: parseIntStrict(process.env.MAM_BONUS_TARGET, 90000),
    donatePoints: parseIntStrict(process.env.MAM_DONATE_POINTS, 2000),
    minUploadSpend: parseIntStrict(process.env.MAM_MIN_UPLOAD_SPEND, 500),
    timeoutMs: parseIntStrict(process.env.MAM_TIMEOUT_MS, 45000),
    debugDir: process.env.MAM_DEBUG_DIR || './debug',
    humanize: parseBool(process.env.MAM_HUMANIZE, true),
    humanDelayMinMs: parseIntStrict(process.env.MAM_HUMAN_DELAY_MIN_MS, 350),
    humanDelayMaxMs: parseIntStrict(process.env.MAM_HUMAN_DELAY_MAX_MS, 1300),
    typeDelayMinMs: parseIntStrict(process.env.MAM_TYPE_DELAY_MIN_MS, 60),
    typeDelayMaxMs: parseIntStrict(process.env.MAM_TYPE_DELAY_MAX_MS, 140),
    preClickHoverMinMs: parseIntStrict(process.env.MAM_PRE_CLICK_HOVER_MIN_MS, 140),
    preClickHoverMaxMs: parseIntStrict(process.env.MAM_PRE_CLICK_HOVER_MAX_MS, 420),
    slowMoMs: parseIntStrict(process.env.MAM_SLOW_MO_MS, 45),
  };
}

function actionResult(name, status, extra = {}) {
  return { name, status, ...extra };
}

async function humanPause(page, config, minMs = null, maxMs = null) {
  const lower = Number.isFinite(minMs) ? minMs : config.humanDelayMinMs;
  const upper = Number.isFinite(maxMs) ? maxMs : config.humanDelayMaxMs;
  const delay = config.humanize ? randomInt(lower, upper) : 20;
  await page.waitForTimeout(delay);
}

async function humanType(page, locator, value, config) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.click({ delay: config.humanize ? randomInt(60, 180) : 20 });
  await humanPause(page, config, 120, 360);

  await locator.fill('');
  if (!config.humanize) {
    await locator.fill(String(value));
    return;
  }

  const text = String(value ?? '');
  for (const char of text) {
    const delay = randomInt(config.typeDelayMinMs, config.typeDelayMaxMs);
    await locator.type(char, { delay });
  }
}

async function humanClick(page, locator, config, clickOptions = {}) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await humanPause(page, config, 140, 480);

  if (config.humanize) {
    const box = await locator.boundingBox().catch(() => null);
    if (box) {
      const xPadMax = Math.max(2, Math.floor(box.width) - 2);
      const yPadMax = Math.max(2, Math.floor(box.height) - 2);
      const xOffset = xPadMax > 2 ? randomInt(2, xPadMax) : Math.floor(box.width / 2);
      const yOffset = yPadMax > 2 ? randomInt(2, yPadMax) : Math.floor(box.height / 2);
      const x = box.x + xOffset;
      const y = box.y + yOffset;
      await page.mouse.move(x, y, { steps: randomInt(7, 20) });
      await page.waitForTimeout(randomInt(config.preClickHoverMinMs, config.preClickHoverMaxMs));
    }
  }

  await locator.click({
    delay: config.humanize ? randomInt(60, 220) : 20,
    ...clickOptions,
  });
}

async function humanNavigate(page, url, config) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
  await humanPause(page, config, 180, 700);
}

async function waitForPageToSettle(page) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    return;
  } catch {
    // Keep going if navigation was same-page or ajax only.
  }
  await page.waitForTimeout(1200);
}

async function ensureLoggedIn(page, config) {
  await humanNavigate(page, config.loginUrl, config);

  const loginForm = page.locator("form[action='/takelogin.php']").first();
  if (!(await loginForm.count())) {
    await humanNavigate(page, 'https://www.myanonamouse.net/login.php?returnto=%2Fstore.php', config);
  }

  const emailInput = page.locator("input[name='email']").first();
  const passwordInput = page.locator("input[name='password']").first();

  if (!(await emailInput.count()) || !(await passwordInput.count())) {
    throw new Error('Could not find login fields (email/password).');
  }

  await humanType(page, emailInput, config.email, config);
  await humanPause(page, config, 180, 520);
  await humanType(page, passwordInput, config.password, config);
  await humanPause(page, config, 250, 900);

  const rememberMe = page.locator("input[name='rememberMe']");
  if (await rememberMe.count()) {
    const checked = await rememberMe.isChecked().catch(() => true);
    if (!checked) {
      await humanClick(page, rememberMe, config);
      await humanPause(page, config, 120, 320);
    }
  }

  const submitBtn = page
    .locator("form[action='/takelogin.php'] input[type='submit'], form[action='/takelogin.php'] button[type='submit']")
    .first();

  if (!(await submitBtn.count())) {
    throw new Error('Could not find the login submit button.');
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: config.timeoutMs }).catch(() => null),
    humanClick(page, submitBtn, config),
  ]);

  await waitForPageToSettle(page);
  await humanPause(page, config, 300, 1000);

  const bodyText = (await page.locator('body').innerText()).toLowerCase();
  const stillOnLogin = page.url().includes('/login.php') || (await page.locator("input[name='password']").count()) > 0;
  const likelyAuthFailure = stillOnLogin || page.url().includes('/takelogin.php') || bodyText.includes('not logged in!');
  if (likelyAuthFailure) {
    const authHints = [
      'login locked',
      'maximum login attempts',
      'unable to log in',
      'not logged in',
      'problem logging in',
      'cookies enabled',
      'failed login',
    ];
    const matchedHint = authHints.find((hint) => bodyText.includes(hint));
    if (matchedHint) {
      throw new Error(`Login failed or was blocked by site checks (hint: ${matchedHint}).`);
    }
  }
}

async function openStore(page, config) {
  await humanNavigate(page, config.storeUrl, config);
  await waitForPageToSettle(page);
  await humanPause(page, config, 220, 720);

  if (page.url().includes('/login.php')) {
    throw new Error('Session is not authenticated when opening /store.php.');
  }
}

async function getBodyText(page) {
  return page.locator('body').innerText();
}

function parseBonusCandidates(bodyText) {
  const candidates = [];
  const lines = bodyText
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const patterns = [
    /(?:bonus(?:\s+points?)?|seedbonus|karma)\D{0,30}([0-9][0-9,\. ]{0,20})/i,
    /([0-9][0-9,\. ]{0,20})\D{0,30}(?:bonus(?:\s+points?)?|seedbonus|karma)/i,
    /you\s+(?:currently\s+)?have\D{0,20}([0-9][0-9,\. ]{0,20})\D{0,20}(?:points?|bonus|seedbonus|karma)/i,
  ];

  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) {
        continue;
      }
      const value = numberFromText(match[1]);
      if (value !== null && value <= 500000) {
        candidates.push({ value, line });
      }
    }
  }

  return candidates;
}

async function readBonusPoints(page) {
  const bodyText = await getBodyText(page);
  const candidates = parseBonusCandidates(bodyText);

  if (!candidates.length) {
    return { value: null, evidence: [] };
  }

  const priority = candidates
    .map((c) => {
      const l = c.line.toLowerCase();
      let rank = 0;
      if (l.includes('current bonus points')) rank += 20;
      if (l.includes('bonus:')) rank += 8;
      if (l.includes('current') && (l.includes('bonus') || l.includes('seedbonus') || l.includes('karma'))) rank += 6;
      if (l.includes('bonus points')) rank += 4;
      if (l.includes('seedbonus')) rank += 3;
      if (l.includes('karma')) rank += 2;
      if (l.includes('you have')) rank += 1;
      if (l.includes('buy') && l.includes('for')) rank -= 8;
      if (l.includes('seedtime fix')) rank -= 8;
      if (l.includes('guide') || l.includes('faq')) rank -= 3;
      return { ...c, rank };
    })
    .sort((a, b) => b.rank - a.rank || a.value - b.value);

  const picked = priority[0];
  return {
    value: picked.value,
    evidence: priority.slice(0, 5),
  };
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

async function readCurrentBonus(page) {
  const bonusElText = await page.locator('#currentBonusPoints').first().textContent().catch(() => null);
  const bonusFromElement = numberFromText(bonusElText);
  if (bonusFromElement !== null) {
    return {
      value: bonusFromElement,
      evidence: [{ value: bonusFromElement, line: `#currentBonusPoints: ${normalizeText(bonusElText)}`, rank: 100 }],
    };
  }
  return readBonusPoints(page);
}

async function readDonationHistory(page) {
  const rows = await page.$$eval('table tr', (trs) => {
    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    return trs.map((tr) => Array.from(tr.querySelectorAll('th,td')).map((c) => clean(c.textContent || '')));
  });

  const parsed = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.length >= 2 && /date/i.test(row[0]) && /amount/i.test(row[1])) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const r = rows[j];
        if (r.length < 2 || !r[0] || !r[1]) {
          continue;
        }
        parsed.push({ date: r[0], amount: r[1] });
      }
      break;
    }
  }

  return parsed;
}

async function getMillionaireStatus(page, config) {
  await humanNavigate(page, 'https://www.myanonamouse.net/millionaires/pot.php', config);
  await waitForPageToSettle(page);

  const bodyText = await getBodyText(page);
  const lower = bodyText.toLowerCase();
  const canDonateToday = lower.includes('you have not donated today');
  const alreadyDonatedToday = lower.includes('you have donated today') || lower.includes('already donated today');
  const maxMatch = bodyText.match(/currently donate\s+([0-9,]+)/i);
  const maxDonateToday = maxMatch ? numberFromText(maxMatch[1]) : null;

  const donateButton = page
    .locator("input[type='submit'][value*='Donate to the pot now'], button:has-text('Donate to the pot now')")
    .first();

  return {
    canDonateToday,
    alreadyDonatedToday,
    maxDonateToday,
    donateButtonAvailable: (await donateButton.count()) > 0,
    donationHistory: await readDonationHistory(page),
  };
}

function parseDateToIso(input) {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function mapDonationHistory(donationHistory) {
  return donationHistory
    .map((entry) => {
      const amount = numberFromText(entry.amount);
      const dateIso = parseDateToIso(entry.date) ?? entry.date;
      if (amount === null) {
        return null;
      }
      return {
        dateIso,
        amount,
      };
    })
    .filter((entry) => entry !== null);
}

async function readVipWeeksRemaining(page) {
  const bodyText = await getBodyText(page);
  const patterns = [
    /vip expires in\s+([0-9]+(?:\.[0-9]+)?)\s+weeks/i,
    /([0-9]+(?:\.[0-9]+)?)\s+weeks?\s+of vip status remaining/i,
  ];

  for (const pattern of patterns) {
    const match = bodyText.match(pattern);
    if (!match) {
      continue;
    }
    const parsed = Number.parseFloat(match[1]);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

async function buildLiveSnapshot(page, config, currentBonus) {
  await openStore(page, config);
  const vipWeeksRemaining = await readVipWeeksRemaining(page);
  const millionaireStatus = await getMillionaireStatus(page, config);

  return {
    bonusPoints: currentBonus,
    threshold: config.bonusThreshold,
    target: config.bonusTarget,
    maxCap: config.bonusCap,
    donatedToday: millionaireStatus.alreadyDonatedToday,
    maxDailyDonation: millionaireStatus.maxDonateToday ?? config.donatePoints,
    vipWeeksRemaining,
    checkedAtIso: new Date().toISOString(),
    donationHistory: mapDonationHistory(millionaireStatus.donationHistory),
  };
}

async function openMillionaireDonatePage(page, config) {
  const donateButton = page
    .locator("input[type='submit'][value*='Donate to the pot now'], button:has-text('Donate to the pot now')")
    .first();

  if (await donateButton.count()) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: config.timeoutMs }).catch(() => null),
      humanClick(page, donateButton, config),
    ]);
    await waitForPageToSettle(page);
  }

  if (!page.url().includes('/millionaires/donate.php')) {
    await humanNavigate(page, 'https://www.myanonamouse.net/millionaires/donate.php', config);
    await waitForPageToSettle(page);
  }
}

async function readDialogMessage(page) {
  const dialog = page.locator('#dialog-message').first();
  const visible = await dialog.isVisible().catch(() => false);
  if (!visible) {
    return '';
  }
  return normalizeText(await dialog.innerText().catch(() => ''));
}

async function clickDialogButton(page, config, preferredLabels) {
  for (const label of preferredLabels) {
    const button = page.locator(`.ui-dialog-buttonpane button:has-text('${label}')`).first();
    if (await button.count()) {
      await humanClick(page, button, config);
      return true;
    }
  }

  const fallback = page.locator('.ui-dialog-buttonpane button').first();
  if (await fallback.count()) {
    await humanClick(page, fallback, config);
    return true;
  }

  return false;
}

async function triggerStoreBonusButton(page, config, sectionSelector, buttonLabel, apply) {
  const button = page.locator(`${sectionSelector} button`, { hasText: buttonLabel }).first();
  if (!(await button.count())) {
    return { ok: false, reason: `Button not found: ${buttonLabel}` };
  }

  if (!apply) {
    return { ok: true, planned: true, buttonLabel };
  }

  await humanClick(page, button, config);
  await humanPause(page, config, 200, 550);

  const confirmText = await readDialogMessage(page);
  if (!confirmText) {
    return { ok: false, reason: `No confirmation dialog after clicking ${buttonLabel}` };
  }

  const responsePromise = page
    .waitForResponse((response) => response.url().includes('/json/bonusBuy.php'), { timeout: config.timeoutMs })
    .catch(() => null);

  const clickedYes = await clickDialogButton(page, config, ['Yes', 'OK', 'Ok']);
  if (!clickedYes) {
    return { ok: false, reason: `Could not confirm dialog for ${buttonLabel}`, confirmText };
  }

  const response = await responsePromise;
  const api = response ? await response.json().catch(() => null) : null;

  await humanPause(page, config, 250, 700);
  const resultDialog = await readDialogMessage(page);
  if (resultDialog) {
    await clickDialogButton(page, config, ['OK', 'Ok', 'Close']).catch(() => {});
  }

  return {
    ok: true,
    applied: true,
    buttonLabel,
    confirmText,
    api,
    resultDialog,
  };
}

function planVipButtons(remainingPoints) {
  const plan = [];
  if (remainingPoints >= 15000) {
    plan.push({ label: '12 Weeks', cost: 15000 });
  }
  if (remainingPoints >= 10000) {
    plan.push({ label: '8 Weeks', cost: 10000 });
  }
  if (remainingPoints >= 5000) {
    plan.push({ label: '4 Weeks', cost: 5000 });
  }
  plan.push({ label: 'Max me out!', cost: null });

  return plan.filter((item, idx) => plan.findIndex((x) => x.label === item.label) === idx);
}

const uploadPurchaseOptions = [
  { label: '100 GB', cost: 50000 },
  { label: '50 GB', cost: 25000 },
  { label: '20 GB', cost: 10000 },
  { label: '5 GB', cost: 2500 },
  { label: '2.5 GB', cost: 1250 },
  { label: '1 GB', cost: 500 },
];

function planUploadPurchases(remainingPoints) {
  let rem = Math.max(0, remainingPoints);
  const plan = [];

  while (rem >= 500 && plan.length < 30) {
    const pick = uploadPurchaseOptions.find((opt) => opt.cost <= rem);
    if (!pick) {
      break;
    }
    plan.push(pick);
    rem -= pick.cost;
  }

  return { plan, unspent: rem };
}

async function performMillionaireDonation(page, config, apply, remainingToSpend) {
  const status = await getMillionaireStatus(page, config);
  if (!status.canDonateToday) {
    return actionResult('donate_millionaires_club', 'skipped', {
      reason: status.alreadyDonatedToday ? 'Already donated today.' : 'Donation unavailable today.',
      millionaireStatus: status,
    });
  }

  const donateLimit = status.maxDonateToday ?? config.donatePoints;
  const targetDonation = Math.min(config.donatePoints, donateLimit, Math.max(0, remainingToSpend));
  if (targetDonation < 100) {
    return actionResult('donate_millionaires_club', 'skipped', {
      reason: `Donation target ${targetDonation} is below minimum option (100).`,
      millionaireStatus: status,
    });
  }

  await openMillionaireDonatePage(page, config);

  const donationSelect = page.locator("form[action='/millionaires/donate.php'] select[name='Donation']").first();
  if (!(await donationSelect.count())) {
    return actionResult('donate_millionaires_club', 'failed', {
      reason: 'Donation dropdown was not found on donate page.',
    });
  }

  const optionValues = await donationSelect.evaluate((select) =>
    Array.from(select.options)
      .map((opt) => {
        const digits = String(opt.value || opt.textContent || '').replace(/[^0-9]/g, '');
        const n = digits ? Number.parseInt(digits, 10) : null;
        return Number.isFinite(n) ? n : null;
      })
      .filter((v) => v !== null),
  );

  const sorted = optionValues.sort((a, b) => b - a);
  const picked = sorted.find((v) => v <= targetDonation);
  if (!picked) {
    return actionResult('donate_millionaires_club', 'skipped', {
      reason: `No donation option <= target (${targetDonation}) was available.`,
      options: sorted,
    });
  }

  if (!apply) {
    return actionResult('donate_millionaires_club', 'planned', {
      donationPoints: picked,
      maxDonateToday: status.maxDonateToday,
    });
  }

  await donationSelect.scrollIntoViewIfNeeded().catch(() => {});
  await humanPause(page, config, 120, 360);
  await donationSelect.selectOption(String(picked));
  await humanPause(page, config, 120, 360);

  const submitButton = page.locator("form[action='/millionaires/donate.php'] input[type='submit'][name='submit']").first();
  if (!(await submitButton.count())) {
    return actionResult('donate_millionaires_club', 'failed', { reason: 'Donation submit button not found.' });
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: config.timeoutMs }).catch(() => null),
    humanClick(page, submitButton, config),
  ]);
  await waitForPageToSettle(page);

  const after = await getMillionaireStatus(page, config);
  return actionResult('donate_millionaires_club', 'applied', {
    donationPoints: picked,
    postStatus: after,
  });
}

async function performVipSpend(page, config, apply, remainingToSpend) {
  const vipPlan = planVipButtons(remainingToSpend);
  if (!vipPlan.length) {
    return actionResult('extend_vip', 'skipped', { reason: 'No VIP purchase options were planned.' });
  }

  if (!apply) {
    return actionResult('extend_vip', 'planned', { candidates: vipPlan });
  }

  await openStore(page, config);
  const attempts = [];
  for (const candidate of vipPlan) {
    const result = await triggerStoreBonusButton(page, config, '.vipStatusContent', candidate.label, true);
    attempts.push({ candidate, result });
    if (result.ok && (!result.api || result.api.success !== false)) {
      return actionResult('extend_vip', 'applied', {
        selected: candidate,
        response: result,
        attempts,
      });
    }
    await humanPause(page, config, 250, 700);
  }

  return actionResult('extend_vip', 'failed', {
    reason: 'No VIP button produced a successful purchase.',
    attempts,
  });
}

async function performUploadSpend(page, config, apply, remainingToSpend) {
  const planned = planUploadPurchases(remainingToSpend);
  if (!planned.plan.length) {
    return actionResult('buy_upload_credit', 'skipped', {
      reason: `Remaining spend (${remainingToSpend}) is below minimum upload spend (${config.minUploadSpend}).`,
    });
  }

  if (!apply) {
    return actionResult('buy_upload_credit', 'planned', {
      sequence: planned.plan,
      estimatedUnspent: planned.unspent,
    });
  }

  await openStore(page, config);
  const attempts = [];
  for (const step of planned.plan) {
    const result = await triggerStoreBonusButton(page, config, '.uploadCreditContent', step.label, true);
    attempts.push({ step, result });
    if (!result.ok || (result.api && result.api.success === false)) {
      break;
    }
    await humanPause(page, config, 200, 600);
  }

  const successful = attempts.filter((attempt) => attempt.result.ok && (!attempt.result.api || attempt.result.api.success !== false));
  if (!successful.length) {
    return actionResult('buy_upload_credit', 'failed', {
      reason: 'No upload credit purchase succeeded.',
      attempts,
    });
  }

  return actionResult('buy_upload_credit', 'applied', {
    successful,
    attempts,
  });
}

async function discoverForms(page) {
  return page.$$eval('form', (forms) => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const getLabel = (node) => {
      const own =
        node.getAttribute('value') ||
        node.getAttribute('aria-label') ||
        node.getAttribute('title') ||
        node.textContent ||
        '';
      return clean(own);
    };

    return forms.map((form, index) => {
      const text = clean(form.innerText || form.textContent || '');
      const controls = Array.from(
        form.querySelectorAll("button, input[type='submit'], input[type='button']"),
      )
        .map((node) => getLabel(node))
        .filter(Boolean);

      const inputs = Array.from(form.querySelectorAll('input, select, textarea')).map((node) => ({
        tag: node.tagName.toLowerCase(),
        type: clean(node.getAttribute('type') || ''),
        name: clean(node.getAttribute('name') || ''),
        id: clean(node.getAttribute('id') || ''),
        placeholder: clean(node.getAttribute('placeholder') || ''),
      }));

      return {
        index,
        action: clean(form.getAttribute('action') || ''),
        method: clean(form.getAttribute('method') || '').toLowerCase(),
        text,
        controls,
        inputs,
      };
    });
  });
}

function scoreForm(form, sectionKeywords, actionKeywords) {
  const text = `${form.text} ${form.controls.join(' ')}`.toLowerCase();

  const sectionHits = sectionKeywords.filter((keyword) => text.includes(keyword)).length;
  if (sectionKeywords.length && sectionHits === 0) {
    return -1;
  }

  const actionHits = actionKeywords.filter((keyword) => text.includes(keyword)).length;
  return sectionHits * 10 + actionHits * 2 + (form.controls.length ? 1 : 0);
}

function pickBestForm(forms, sectionKeywords, actionKeywords) {
  let best = null;
  let bestScore = -1;

  for (const form of forms) {
    const score = scoreForm(form, sectionKeywords, actionKeywords);
    if (score > bestScore) {
      best = form;
      bestScore = score;
    }
  }

  return bestScore < 0 ? null : best;
}

async function submitFormAction(page, formIndex, opts, config) {
  const formLocator = page.locator('form').nth(formIndex);

  if (!(await formLocator.count())) {
    return { ok: false, message: `Form at index ${formIndex} not found anymore.` };
  }

  const formSnapshot = await formLocator.evaluate((form) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const parseNumber = (value) => {
      const digits = String(value || '').replace(/[^0-9]/g, '');
      if (!digits) return null;
      const parsed = Number.parseInt(digits, 10);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const buttons = Array.from(form.querySelectorAll("button, input[type='submit'], input[type='button']")).map(
      (node, index) => ({
        index,
        label: normalize(node.getAttribute('value') || node.getAttribute('aria-label') || node.textContent || ''),
      }),
    );

    const inputs = Array.from(form.querySelectorAll("input[type='number'], input[type='text']")).map(
      (node, index) => {
        const name = normalize(node.getAttribute('name'));
        const id = normalize(node.getAttribute('id'));
        const placeholder = normalize(node.getAttribute('placeholder'));
        return {
          index,
          name,
          id,
          placeholder,
          key: `${name} ${id} ${placeholder}`.toLowerCase(),
        };
      },
    );

    const selects = Array.from(form.querySelectorAll('select')).map((node, index) => {
      const name = normalize(node.getAttribute('name'));
      const id = normalize(node.getAttribute('id'));
      return {
        index,
        name,
        id,
        key: `${name} ${id}`.toLowerCase(),
        options: Array.from(node.options).map((opt) => ({
          value: opt.value,
          text: normalize(opt.textContent || ''),
          n: parseNumber(opt.textContent || opt.value || ''),
          disabled: opt.disabled,
        })),
      };
    });

    return { buttons, inputs, selects };
  });

  let amountSet = null;
  if (Number.isFinite(opts.pointsHint) && opts.pointsHint > 0) {
    const scoredInputs = formSnapshot.inputs
      .map((input) => {
        let score = 0;
        if (input.key.includes('point')) score += 5;
        if (input.key.includes('bonus')) score += 4;
        if (input.key.includes('amount')) score += 3;
        if (input.key.includes('vip')) score += 2;
        if (input.key.includes('week')) score += 1;
        return { ...input, score };
      })
      .sort((a, b) => b.score - a.score);

    const pickedInput = scoredInputs[0];
    if (pickedInput && (pickedInput.score > 0 || formSnapshot.inputs.length === 1)) {
      amountSet = { type: 'input', field: pickedInput.key, amount: opts.pointsHint };
      if (opts.apply) {
        const inputLocator = formLocator.locator("input[type='number'], input[type='text']").nth(pickedInput.index);
        await humanType(page, inputLocator, opts.pointsHint, config);
        await humanPause(page, config, 140, 440);
      }
    } else {
      const scoredSelects = formSnapshot.selects
        .map((sel) => {
          let score = 0;
          if (sel.key.includes('vip')) score += 4;
          if (sel.key.includes('week')) score += 3;
          if (sel.key.includes('point')) score += 2;
          if (sel.key.includes('bonus')) score += 2;
          return { ...sel, score };
        })
        .sort((a, b) => b.score - a.score);

      const pickedSelect = scoredSelects[0];
      if (pickedSelect) {
        const numericOptions = pickedSelect.options.filter((opt) => opt.n !== null && !opt.disabled);
        if (numericOptions.length > 0) {
          let pickedOption = numericOptions
            .filter((opt) => opt.n <= opts.pointsHint)
            .sort((a, b) => b.n - a.n)[0];
          if (!pickedOption) {
            pickedOption = numericOptions.sort((a, b) => a.n - b.n)[0];
          }

          amountSet = {
            type: 'select',
            field: pickedSelect.key,
            amount: opts.pointsHint,
            option: { text: pickedOption.text, value: pickedOption.value, numeric: pickedOption.n },
          };

          if (opts.apply) {
            const selectLocator = formLocator.locator('select').nth(pickedSelect.index);
            await selectLocator.scrollIntoViewIfNeeded().catch(() => {});
            await humanPause(page, config, 120, 380);
            await selectLocator.selectOption(pickedOption.value);
            await humanPause(page, config, 140, 440);
          }
        }
      }
    }
  }

  const labelMatches = (label) => {
    const l = String(label || '').toLowerCase();
    return opts.actionKeywords.some((keyword) => l.includes(keyword));
  };

  let chosenButton = null;
  for (const button of formSnapshot.buttons) {
    if (labelMatches(button.label)) {
      chosenButton = button;
      break;
    }
  }
  if (!chosenButton && formSnapshot.buttons.length > 0) {
    chosenButton = formSnapshot.buttons[0];
  }

  if (!chosenButton) {
    return {
      ok: false,
      message: 'No submit/button controls found in selected form.',
      availableButtons: formSnapshot.buttons,
      amountSet,
    };
  }

  if (opts.apply) {
    const buttonLocator = formLocator
      .locator("button, input[type='submit'], input[type='button']")
      .nth(chosenButton.index);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: config.timeoutMs }).catch(() => null),
      humanClick(page, buttonLocator, config),
    ]);

    await waitForPageToSettle(page);
    await humanPause(page, config, 260, 860);
  }

  return {
    ok: true,
    applied: Boolean(opts.apply),
    chosenButton: chosenButton.label,
    amountSet,
    availableButtons: formSnapshot.buttons,
  };
}

async function performAction(page, forms, spec, apply, pointsHint, config) {
  const picked = pickBestForm(forms, spec.sectionKeywords, spec.actionKeywords);
  if (!picked) {
    return actionResult(spec.name, 'skipped', {
      reason: `No form found for section keywords: ${spec.sectionKeywords.join(', ')}`,
    });
  }

  const submission = await submitFormAction(page, picked.index, {
    apply,
    pointsHint,
    actionKeywords: spec.actionKeywords,
  }, config);

  if (!submission?.ok) {
    return actionResult(spec.name, 'failed', {
      formIndex: picked.index,
      reason: submission?.message || 'Form submission helper failed.',
      debug: submission,
    });
  }

  return actionResult(spec.name, apply ? 'applied' : 'planned', {
    formIndex: picked.index,
    chosenButton: submission.chosenButton,
    amountSet: submission.amountSet || null,
  });
}

async function saveDebugArtifacts(page, config, label, forms = []) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.resolve(config.debugDir, `${stamp}-${label}`);
  await fs.mkdir(dir, { recursive: true });

  const htmlPath = path.join(dir, 'page.html');
  const screenshotPath = path.join(dir, 'page.png');
  const formsPath = path.join(dir, 'forms.json');

  const html = await page.content();
  await fs.writeFile(htmlPath, html, 'utf8');
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  await fs.writeFile(formsPath, JSON.stringify(forms, null, 2), 'utf8');

  return { dir, htmlPath, screenshotPath, formsPath };
}

function printSummary(summary, config) {
  if (config.jsonOutput) {
    console.log(JSON.stringify(summary));
    return;
  }

  console.log('\nRun summary');
  console.log(JSON.stringify(summary, null, 2));
}

async function run() {
  const config = buildConfig();

  if (!config.email || !config.password) {
    throw new Error('Missing credentials. Set MAM_EMAIL (or MAM_USERNAME) and MAM_PASSWORD in .env.');
  }

  const summary = {
    mode: config.apply ? 'apply' : 'dry-run',
    threshold: config.bonusThreshold,
    target: config.bonusTarget,
    cap: config.bonusCap,
    interactionProfile: config.humanize ? 'humanized' : 'fast',
    actions: [],
  };

  const browser = await chromium.launch({
    headless: config.headless,
    slowMo: config.humanize ? config.slowMoMs : 0,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });

  const page = await context.newPage();

  try {
    await ensureLoggedIn(page, config);
    await openStore(page, config);

    const before = await readCurrentBonus(page);
    summary.startingBonus = before.value;
    summary.bonusEvidence = before.evidence;

    if (before.value === null) {
      const forms = await discoverForms(page);
      const debug = await saveDebugArtifacts(page, config, 'bonus-not-found', forms);
      summary.debug = debug;
      throw new Error('Could not parse current bonus points from the store page.');
    }

    if (config.snapshotOnly) {
      const snapshot = await buildLiveSnapshot(page, config, before.value);
      printSummary(snapshot, config);
      return;
    }

    const shouldSpend = before.value >= config.bonusThreshold;
    summary.shouldSpend = shouldSpend;

    if (!shouldSpend) {
      summary.note = `Bonus points (${before.value}) are below threshold (${config.bonusThreshold}); no spending planned.`;
      printSummary(summary, config);
      return;
    }

    let currentBonus = before.value;
    let remainingToSpend = Math.max(0, currentBonus - config.bonusTarget);

    const donation = await performMillionaireDonation(page, config, config.apply, remainingToSpend);
    summary.actions.push(donation);
    if (donation.status === 'applied') {
      await openStore(page, config);
      const afterDonation = await readCurrentBonus(page);
      if (afterDonation.value !== null) {
        currentBonus = afterDonation.value;
        summary.afterDonationBonus = currentBonus;
        remainingToSpend = Math.max(0, currentBonus - config.bonusTarget);
      }
    }

    if (remainingToSpend > 0) {
      const vip = await performVipSpend(page, config, config.apply, remainingToSpend);
      summary.actions.push(vip);

      if (vip.status === 'applied') {
        await openStore(page, config);
        const afterVip = await readCurrentBonus(page);
        if (afterVip.value !== null) {
          currentBonus = afterVip.value;
          summary.afterVipBonus = currentBonus;
          remainingToSpend = Math.max(0, currentBonus - config.bonusTarget);
        }
      }
    } else {
      summary.actions.push(actionResult('extend_vip', 'skipped', { reason: 'No spend needed after donation step.' }));
    }

    if (remainingToSpend >= config.minUploadSpend) {
      const upload = await performUploadSpend(page, config, config.apply, remainingToSpend);
      summary.actions.push(upload);

      if (upload.status === 'applied') {
        await openStore(page, config);
        const afterUpload = await readCurrentBonus(page);
        if (afterUpload.value !== null) {
          currentBonus = afterUpload.value;
          summary.afterUploadBonus = currentBonus;
          remainingToSpend = Math.max(0, currentBonus - config.bonusTarget);
        }
      }
    } else {
      summary.actions.push(
        actionResult('buy_upload_credit', 'skipped', {
          reason: `Remaining spend (${remainingToSpend}) is below minimum upload spend (${config.minUploadSpend}).`,
        }),
      );
    }

    await openStore(page, config);
    const finalBonus = await readCurrentBonus(page);
    summary.endingBonus = finalBonus.value;
    summary.endingBonusEvidence = finalBonus.evidence;

    const allForms = await discoverForms(page);
    summary.debug = await saveDebugArtifacts(page, config, config.apply ? 'apply-run' : 'dry-run', allForms);

    printSummary(summary, config);
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  if (process.argv.includes('--json')) {
    console.error(JSON.stringify({ error: error.message }));
  } else {
    console.error(`\nRun failed: ${error.message}`);
  }
  process.exitCode = 1;
});
