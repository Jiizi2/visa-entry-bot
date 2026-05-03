export function splitPerMemberStepsByPage(steps, isLikelyNextSelector) {
  const indexed = steps.map((step, originalIndex) => ({ step, originalIndex }));
  const firstNextIndex = indexed.findIndex(({ step }) => {
    const action = String(step?.action ?? "").trim().toLowerCase();
    const selector = String(step?.selector ?? "").trim();
    return action === "click" && isLikelyNextSelector(selector);
  });
  const disclosureIndex = indexed.findIndex(({ step }) => {
    const action = String(step?.action ?? "").trim().toLowerCase();
    const selector = String(step?.selector ?? "").trim().toLowerCase();
    return action === "set_disclosure_all_no" || selector.includes("disclosure form");
  });
  const successIndex = indexed.findIndex(({ step }) => {
    const action = String(step?.action ?? "").trim().toLowerCase();
    const selector = String(step?.selector ?? "").trim().toLowerCase();
    return action === "click_success_popup_action" || selector.includes("mutamer has been added successfully");
  });

  const total = indexed.length;
  const p1End = firstNextIndex >= 0 ? firstNextIndex + 1 : total;
  const p2End = disclosureIndex >= 0 ? disclosureIndex : total;
  const p3End = successIndex >= 0 ? successIndex : total;

  const page1 = indexed.slice(0, Math.max(0, p1End));
  const page2 = indexed.slice(Math.max(0, p1End), Math.max(Math.max(0, p1End), p2End));
  const page3 = indexed.slice(Math.max(Math.max(0, p1End), p2End), Math.max(Math.max(Math.max(0, p1End), p2End), p3End));
  const page4 = indexed.slice(Math.max(Math.max(Math.max(0, p1End), p2End), p3End));

  return [
    { name: "PAGE 1 - Passport & Identity", steps: page1 },
    { name: "PAGE 2 - Personal & Contact", steps: page2 },
    { name: "PAGE 3 - Disclosure", steps: page3 },
    { name: "PAGE 4 - Confirmation", steps: page4 },
  ];
}

export async function executeMemberPageSteps({
  page,
  pageName,
  memberLabel,
  stepEntries,
  contextBase,
  actionTimeout,
  runStep,
}) {
  const VERBOSE_PAGE_STEP_LOG = false;
  const MAX_RATE_LIMIT_RETRY = 6;
  const isDisclosurePage = String(pageName || "").toLowerCase().includes("page 3")
    || String(pageName || "").toLowerCase().includes("disclosure");
  const DISCLOSURE_VERBOSE_RETRY_LIMIT = 2;
  if (!Array.isArray(stepEntries) || !stepEntries.length) {
    if (VERBOSE_PAGE_STEP_LOG) {
      console.log(`${memberLabel} ${pageName} skip (0 step)`);
    }
    return;
  }

  console.log(`${memberLabel} ${pageName} start (${stepEntries.length} step)`);
  for (let i = 0; i < stepEntries.length; i += 1) {
    const entry = stepEntries[i] || {};
    const step = entry.step || {};
    const originalIndex = Number(entry.originalIndex ?? i);
    const stepAction = String(step?.action ?? "").trim().toLowerCase();
    const isFileUploadStep = stepAction === "set_files";
    const isPhoneStep = stepAction === "set_phone_fields";
    let completed = false;
    let attempts = 0;
    let suppressedRetryLogs = 0;

    while (!completed) {
      const shouldLogRetryDetail = !isDisclosurePage
        || attempts < DISCLOSURE_VERBOSE_RETRY_LIMIT
        || attempts + 1 >= MAX_RATE_LIMIT_RETRY;
      const uiRateLimitedBefore = (isFileUploadStep || isPhoneStep) ? false : await isRateLimitedFromUi(page);
      if (uiRateLimitedBefore) {
        const preCooldownMs = 15000 + Math.floor(Math.random() * 10000);
        if (shouldLogRetryDetail) {
          console.log(`${memberLabel} ${pageName} step[${originalIndex}] menunggu rate-limit reda (${Math.round(preCooldownMs / 1000)}s)`);
        } else {
          suppressedRetryLogs += 1;
        }
        await page.waitForTimeout(preCooldownMs);
      }

      attempts += 1;
      try {
        if (VERBOSE_PAGE_STEP_LOG) {
          console.log(`${memberLabel} ${pageName} step[${originalIndex}] execute`);
        }
        await runStep(
          page,
          step,
          {
            ...contextBase,
            index: originalIndex,
          },
          actionTimeout
        );
        if (VERBOSE_PAGE_STEP_LOG) {
          console.log(`${memberLabel} ${pageName} step[${originalIndex}] success`);
        }

        const uiRateLimitedAfter = (isFileUploadStep || isPhoneStep) ? false : await isRateLimitedFromUi(page);
        if (uiRateLimitedAfter && attempts <= MAX_RATE_LIMIT_RETRY) {
          const cooldownMs = 14000 + Math.floor(Math.random() * 10000) + ((attempts - 1) * 5000);
          if (shouldLogRetryDetail) {
            console.log(`${memberLabel} ${pageName} step[${originalIndex}] rate-limit setelah step, cooldown ${Math.round(cooldownMs / 1000)}s lalu retry (${attempts}/${MAX_RATE_LIMIT_RETRY})`);
          } else {
            suppressedRetryLogs += 1;
          }
          await page.waitForTimeout(cooldownMs);
          continue;
        }

        if (suppressedRetryLogs > 0) {
          console.log(`${memberLabel} ${pageName} step[${originalIndex}] retry log diringkas (${suppressedRetryLogs} event disembunyikan)`);
        }
        completed = true;
      } catch (error) {
        const errorText = String(error instanceof Error ? error.message : error || "").toLowerCase();
        const likelyRateLimited = (isFileUploadStep || isPhoneStep)
          ? isLikelyRateLimitedMessage(errorText)
          : (isLikelyRateLimitedMessage(errorText) || await isRateLimitedFromUi(page));
        if (likelyRateLimited && attempts <= MAX_RATE_LIMIT_RETRY) {
          const cooldownMs = 12000 + Math.floor(Math.random() * 8000) + ((attempts - 1) * 5000);
          if (shouldLogRetryDetail) {
            console.log(`${memberLabel} ${pageName} step[${originalIndex}] rate-limit terdeteksi, cooldown ${Math.round(cooldownMs / 1000)}s lalu retry (${attempts}/${MAX_RATE_LIMIT_RETRY})`);
          } else {
            suppressedRetryLogs += 1;
          }
          await page.waitForTimeout(cooldownMs);
          continue;
        }

        console.log(`${memberLabel} ${pageName} step[${originalIndex}] fail: ${error instanceof Error ? error.message : String(error)}`);
        if (suppressedRetryLogs > 0) {
          console.log(`${memberLabel} ${pageName} step[${originalIndex}] retry log diringkas (${suppressedRetryLogs} event disembunyikan)`);
        }
        if (!step?.continue_on_error) {
          throw error;
        }
        completed = true;
      }
    }
  }
  console.log(`${memberLabel} ${pageName} done`);
}

function isLikelyRateLimitedMessage(messageLower) {
  const text = String(messageLower || "");
  if (!text) {
    return false;
  }
  return text.includes("too many request")
    || text.includes("too many requests")
    || text.includes("rate limit")
    || text.includes("429")
    || text.includes("throttl");
}

async function isRateLimitedFromUi(page) {
  return page.evaluate(() => {
    const text = String(document.body?.innerText || "").toLowerCase();
    return text.includes("too many request")
      || text.includes("too many requests")
      || text.includes("rate limit")
      || text.includes("429")
      || text.includes("try again later");
  }).catch(() => false);
}
