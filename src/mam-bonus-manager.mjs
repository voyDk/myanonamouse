import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import dotenv from 'dotenv';
import { chromium } from 'playwright';

dotenv.config();

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
  const apply = args.has('--apply') || parseBool(process.env.MAM_APPLY, false);
  const headed = args.has('--headed') || parseBool(process.env.MAM_HEADLESS, false) === false;

  return {
    email: process.env.MAM_EMAIL || process.env.MAM_USERNAME || '',
    password: process.env.MAM_PASSWORD || '',
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

  const stillOnLogin = page.url().includes('/login.php') || (await page.locator("input[name='password']").count()) > 0;
  if (stillOnLogin) {
    const bodyText = (await page.locator('body').innerText()).toLowerCase();
    const authHints = ['not logged in', 'problem logging in', 'cookies enabled', 'failed login'];
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
      if (l.includes('bonus points')) rank += 4;
      if (l.includes('seedbonus')) rank += 3;
      if (l.includes('karma')) rank += 2;
      if (l.includes('you have')) rank += 1;
      return { ...c, rank };
    })
    .sort((a, b) => b.rank - a.rank || b.value - a.value);

  const picked = priority[0];
  return {
    value: picked.value,
    evidence: priority.slice(0, 5),
  };
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

function printSummary(summary) {
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

    const before = await readBonusPoints(page);
    summary.startingBonus = before.value;
    summary.bonusEvidence = before.evidence;

    if (before.value === null) {
      const forms = await discoverForms(page);
      const debug = await saveDebugArtifacts(page, config, 'bonus-not-found', forms);
      summary.debug = debug;
      throw new Error('Could not parse current bonus points from the store page.');
    }

    const shouldSpend = before.value >= config.bonusThreshold;
    summary.shouldSpend = shouldSpend;

    if (!shouldSpend) {
      summary.note = `Bonus points (${before.value}) are below threshold (${config.bonusThreshold}); no spending planned.`;
      printSummary(summary);
      return;
    }

    let remainingToSpend = Math.max(0, before.value - config.bonusTarget);

    const formsBefore = await discoverForms(page);

    const bodyLower = (await getBodyText(page)).toLowerCase();
    const alreadyDonated =
      bodyLower.includes('millionaire') &&
      (bodyLower.includes('already donated') ||
        bodyLower.includes('already contributed') ||
        bodyLower.includes('you have donated'));

    if (alreadyDonated) {
      summary.actions.push(actionResult('donate_millionaires_club', 'skipped', { reason: 'Appears already donated this cycle.' }));
    } else {
      const donationSpend = Math.max(config.donatePoints, Math.min(config.donatePoints, remainingToSpend));
      const donation = await performAction(
        page,
        formsBefore,
        {
          name: 'donate_millionaires_club',
          sectionKeywords: ['millionaire', 'vault', 'pot'],
          actionKeywords: ['donate', 'contribute'],
        },
        config.apply,
        donationSpend,
        config,
      );
      summary.actions.push(donation);

      if (donation.status === 'applied') {
        const afterDonation = await readBonusPoints(page);
        if (afterDonation.value !== null) {
          summary.afterDonationBonus = afterDonation.value;
          remainingToSpend = Math.max(0, afterDonation.value - config.bonusTarget);
        }
      }
    }

    const formsForVip = await discoverForms(page);
    if (remainingToSpend > 0) {
      const vip = await performAction(
        page,
        formsForVip,
        {
          name: 'extend_vip',
          sectionKeywords: ['vip'],
          actionKeywords: ['vip', 'extend', 'buy', 'week'],
        },
        config.apply,
        remainingToSpend,
        config,
      );
      summary.actions.push(vip);

      if (vip.status === 'applied') {
        const afterVip = await readBonusPoints(page);
        if (afterVip.value !== null) {
          summary.afterVipBonus = afterVip.value;
          remainingToSpend = Math.max(0, afterVip.value - config.bonusTarget);
        }
      }
    } else {
      summary.actions.push(actionResult('extend_vip', 'skipped', { reason: 'No spend needed after donation step.' }));
    }

    const formsForUpload = await discoverForms(page);
    if (remainingToSpend >= config.minUploadSpend) {
      const upload = await performAction(
        page,
        formsForUpload,
        {
          name: 'buy_upload_credit',
          sectionKeywords: ['upload', 'credit', 'gb'],
          actionKeywords: ['max', 'upload', 'credit', 'exchange', 'buy'],
        },
        config.apply,
        remainingToSpend,
        config,
      );
      summary.actions.push(upload);
    } else {
      summary.actions.push(
        actionResult('buy_upload_credit', 'skipped', {
          reason: `Remaining spend (${remainingToSpend}) is below minimum upload spend (${config.minUploadSpend}).`,
        }),
      );
    }

    await openStore(page, config);
    const finalBonus = await readBonusPoints(page);
    summary.endingBonus = finalBonus.value;
    summary.endingBonusEvidence = finalBonus.evidence;

    const allForms = await discoverForms(page);
    summary.debug = await saveDebugArtifacts(page, config, config.apply ? 'apply-run' : 'dry-run', allForms);

    printSummary(summary);
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error(`\nRun failed: ${error.message}`);
  process.exitCode = 1;
});
