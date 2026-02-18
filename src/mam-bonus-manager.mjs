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
  };
}

function actionResult(name, status, extra = {}) {
  return { name, status, ...extra };
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
  await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });

  const loginForm = page.locator("form[action='/takelogin.php']").first();
  if (!(await loginForm.count())) {
    await page.goto('https://www.myanonamouse.net/login.php?returnto=%2Fstore.php', {
      waitUntil: 'domcontentloaded',
      timeout: config.timeoutMs,
    });
  }

  const emailInput = page.locator("input[name='email']").first();
  const passwordInput = page.locator("input[name='password']").first();

  if (!(await emailInput.count()) || !(await passwordInput.count())) {
    throw new Error('Could not find login fields (email/password).');
  }

  await emailInput.fill(config.email);
  await passwordInput.fill(config.password);

  const rememberMe = page.locator("input[name='rememberMe']");
  if (await rememberMe.count()) {
    await rememberMe.check().catch(() => {});
  }

  const submitBtn = page
    .locator("form[action='/takelogin.php'] input[type='submit'], form[action='/takelogin.php'] button[type='submit']")
    .first();

  if (!(await submitBtn.count())) {
    throw new Error('Could not find the login submit button.');
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: config.timeoutMs }).catch(() => null),
    submitBtn.click(),
  ]);

  await waitForPageToSettle(page);

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
  await page.goto(config.storeUrl, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
  await waitForPageToSettle(page);

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

async function submitFormAction(page, formIndex, opts) {
  const formLocator = page.locator('form').nth(formIndex);

  if (!(await formLocator.count())) {
    return { ok: false, message: `Form at index ${formIndex} not found anymore.` };
  }

  const result = await formLocator.evaluate(
    (form, options) => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const parseNumber = (value) => {
        const digits = String(value || '').replace(/[^0-9]/g, '');
        if (!digits) return null;
        const parsed = Number.parseInt(digits, 10);
        return Number.isFinite(parsed) ? parsed : null;
      };

      const buttons = Array.from(form.querySelectorAll("button, input[type='submit'], input[type='button']"));
      const buttonMeta = buttons.map((node, idx) => ({
        index: idx,
        label: normalize(node.getAttribute('value') || node.getAttribute('aria-label') || node.textContent || ''),
      }));

      const inputNodes = Array.from(form.querySelectorAll("input[type='number'], input[type='text']"));
      const selectNodes = Array.from(form.querySelectorAll('select'));

      const setAmountOnInput = (amount) => {
        const candidates = inputNodes
          .map((node) => {
            const name = normalize(node.getAttribute('name'));
            const id = normalize(node.getAttribute('id'));
            const placeholder = normalize(node.getAttribute('placeholder'));
            const joined = `${name} ${id} ${placeholder}`.toLowerCase();
            let score = 0;
            if (joined.includes('point')) score += 5;
            if (joined.includes('bonus')) score += 4;
            if (joined.includes('amount')) score += 3;
            if (joined.includes('vip')) score += 2;
            if (joined.includes('week')) score += 1;
            return { node, score, name: joined };
          })
          .sort((a, b) => b.score - a.score);

        const best = candidates[0];
        if (!best) {
          return null;
        }
        best.node.value = String(amount);
        best.node.dispatchEvent(new Event('input', { bubbles: true }));
        best.node.dispatchEvent(new Event('change', { bubbles: true }));
        return { type: 'input', field: best.name, amount };
      };

      const setAmountOnSelect = (amount) => {
        const scoredSelects = selectNodes
          .map((node) => {
            const name = normalize(node.getAttribute('name'));
            const id = normalize(node.getAttribute('id'));
            const joined = `${name} ${id}`.toLowerCase();
            let score = 0;
            if (joined.includes('vip')) score += 4;
            if (joined.includes('week')) score += 3;
            if (joined.includes('point')) score += 2;
            if (joined.includes('bonus')) score += 2;
            return { node, score, name: joined };
          })
          .sort((a, b) => b.score - a.score);

        const bestSelect = scoredSelects[0];
        if (!bestSelect) {
          return null;
        }

        const options = Array.from(bestSelect.node.options).map((opt) => ({
          value: opt.value,
          text: normalize(opt.textContent || ''),
          n: parseNumber(opt.textContent || opt.value || ''),
          disabled: opt.disabled,
        }));

        const numericOptions = options.filter((opt) => opt.n !== null && !opt.disabled);
        if (!numericOptions.length) {
          return null;
        }

        let picked = numericOptions
          .filter((opt) => opt.n <= amount)
          .sort((a, b) => b.n - a.n)[0];

        if (!picked) {
          picked = numericOptions.sort((a, b) => a.n - b.n)[0];
        }

        bestSelect.node.value = picked.value;
        bestSelect.node.dispatchEvent(new Event('input', { bubbles: true }));
        bestSelect.node.dispatchEvent(new Event('change', { bubbles: true }));

        return {
          type: 'select',
          field: bestSelect.name,
          amount,
          option: { text: picked.text, value: picked.value, numeric: picked.n },
        };
      };

      let amountSet = null;
      if (Number.isFinite(options.pointsHint) && options.pointsHint > 0) {
        amountSet = setAmountOnInput(options.pointsHint) || setAmountOnSelect(options.pointsHint) || null;
      }

      const labelMatches = (label) => {
        const l = normalize(label).toLowerCase();
        return options.actionKeywords.some((keyword) => l.includes(keyword));
      };

      let chosenButton = null;
      for (let i = 0; i < buttonMeta.length; i += 1) {
        if (labelMatches(buttonMeta[i].label)) {
          chosenButton = { ...buttonMeta[i], idx: i };
          break;
        }
      }

      if (!chosenButton && buttonMeta.length > 0) {
        chosenButton = { ...buttonMeta[0], idx: 0 };
      }

      if (!chosenButton) {
        return {
          ok: false,
          message: 'No submit/button controls found in selected form.',
          availableButtons: buttonMeta,
          amountSet,
        };
      }

      if (options.apply) {
        buttons[chosenButton.idx].click();
      }

      return {
        ok: true,
        applied: Boolean(options.apply),
        chosenButton: chosenButton.label,
        amountSet,
        availableButtons: buttonMeta,
      };
    },
    {
      apply: opts.apply,
      pointsHint: opts.pointsHint,
      actionKeywords: opts.actionKeywords,
    },
  );

  if (opts.apply && result?.ok) {
    await waitForPageToSettle(page);
  }

  return result;
}

async function performAction(page, forms, spec, apply, pointsHint) {
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
  });

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
    actions: [],
  };

  const browser = await chromium.launch({ headless: config.headless });
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
