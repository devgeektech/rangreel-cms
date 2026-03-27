const { test, expect } = require("@playwright/test");

const clientBrand = process.env.CLIENT_BRAND || "Browser Smoke Brand";
const currentMonth = new Date().toISOString().slice(0, 7);
const API_BASE_URL = "http://localhost:5000/api";

const credentials = {
  strategist: {
    email: "e2e_strategist_smoke_20260325@rangreel.com",
    password: "E2ESmokeStrategist@123!",
    redirectPath: "/strategist",
  },
  manager: {
    email: "e2e_manager_smoke_20260325@rangreel.com",
    password: "E2ESmokeManager@123!",
    redirectPath: "/manager",
  },
  posting: {
    email: "e2e_posting_smoke_20260325@rangreel.com",
    password: "E2ESmokePosting@123!",
    redirectPath: "/posting",
  },
};

function getRangreelTokenHeaderFromCookies(cookies) {
  const cookie = cookies.find((c) => c.name === "rangreel_token");
  expect(cookie, "Expected rangreel_token cookie to be present").toBeTruthy();
  return `rangreel_token=${cookie.value}`;
}

async function login(page, { email, password, redirectPath }) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Wait for role dashboard (mustChangePass is already disabled for smoke users,
  // but we still guard against accidental redirects).
  await page.waitForURL((url) => url.pathname.startsWith(redirectPath), { timeout: 30_000 });
}

async function logout(page) {
  await page.getByRole("button", { name: "Logout" }).click();
  await page.waitForURL(/\/login$/, { timeout: 30_000 });
}

test("Role dashboards: Start/Submit + Approve/Reject + Posting", async ({ page, request }) => {
  // A) Strategist Start/Submit Plan
  await login(page, credentials.strategist);

  const taskCard = page
    .locator(`div.rounded-lg:has-text("${clientBrand}")`)
    .first();
  const startPlanning = taskCard.getByRole("button", { name: "Start Planning" });
  await expect(startPlanning.first()).toBeVisible();
  await startPlanning.first().click();

  // Fill planning inputs
  await taskCard.getByPlaceholder("Write a strong hook...").fill("Smoke hook");
  await taskCard.getByPlaceholder("Concept direction...").fill("Smoke concept");
  await taskCard.getByPlaceholder("Caption direction...").fill("Smoke caption direction");

  await page.getByRole("button", { name: "Submit Plan" }).click();

  // UI evidence (badge)
  await expect(page.getByText("Completed").first()).toBeVisible();

  // Backend evidence
  const strategistTokenHeader = getRangreelTokenHeaderFromCookies(
    await page.context().cookies()
  );
  const strategistRes = await request.get(
    `${API_BASE_URL}/user/my-tasks?month=${encodeURIComponent(currentMonth)}`,
    {
      headers: {
        Cookie: strategistTokenHeader,
      },
    }
  );
  expect(strategistRes.ok()).toBeTruthy();
  const strategistBody = await strategistRes.json();
  expect(strategistBody.success).toBe(true);

  const strategistTasks = strategistBody.data || [];
  const planStagesForBrand = strategistTasks
    .filter((t) => t.clientBrandName === clientBrand)
    .flatMap((t) => t.stages || [])
    .filter((s) => String(s.stageName || "").toLowerCase() === "plan");
  expect(planStagesForBrand.length).toBe(1);
  expect(planStagesForBrand[0].status).toBe("submitted");

  // B) Manager Approve then Reject (approve first pending approval, reject last pending approval)
  await logout(page);
  await login(page, credentials.manager);

  const brandCards = page
    .getByText(clientBrand, { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');

  const approveBtn = brandCards
    .first()
    .getByRole("button", { name: "Approve" })
    .first();
  await expect(approveBtn).toBeVisible();
  await approveBtn.click();

  // After approving one, there should be fewer pending approvals. Reject the last remaining one
  const remainingBrandCards = page
    .getByText(clientBrand, { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');

  const rejectBtn = remainingBrandCards
    .last()
    .getByRole("button", { name: "Reject" })
    .first();
  await expect(rejectBtn).toBeVisible();
  await rejectBtn.click();

  // UI evidence: at least 1 of the previously pending approval buttons should no longer be present
  await expect(page.getByText("Pending Approvals").first()).toBeVisible();
  const brandApproveButtons = page
    .getByText(clientBrand, { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')
    .getByRole("button", { name: "Approve" });
  await expect(brandApproveButtons).toHaveCount(2);

  // Backend evidence: approval stage statuses should include exactly one approved and one rejected,
  // with one of the other approval stages reverted to in_progress due to rejection.
  const managerTokenHeader = getRangreelTokenHeaderFromCookies(await page.context().cookies());
  const managerRes = await request.get(
    `${API_BASE_URL}/manager/clients/global-calendar?month=${encodeURIComponent(currentMonth)}`,
    {
      headers: {
        Cookie: managerTokenHeader,
      },
    }
  );
  expect(managerRes.ok()).toBeTruthy();
  const managerBody = await managerRes.json();
  expect(managerBody.success).toBe(true);
  const groups = managerBody.data?.groups || [];

  const flatItems = groups.flatMap((g) => g.items || []);
  const smokeItem = flatItems.find((it) => {
    return it?.client?.brandName === clientBrand && it?.title === "Static Post #1";
  });
  expect(smokeItem, "Expected to find smoke ContentItem for approval checks").toBeTruthy();

  const approvalStages = (smokeItem.workflowStages || []).filter((s) => {
    return String(s.stageName || "").toLowerCase() === "approval";
  });
  expect(approvalStages.length).toBe(4);

  const approvedCount = approvalStages.filter((s) => s.status === "approved").length;
  const rejectedCount = approvalStages.filter((s) => s.status === "rejected").length;
  const inProgressCount = approvalStages.filter((s) => s.status === "in_progress").length;

  expect(approvedCount).toBe(1);
  expect(rejectedCount).toBe(1);
  expect(inProgressCount).toBeGreaterThanOrEqual(1);

  expect(String(smokeItem.overallStatus || "").toLowerCase()).toBe("scheduled");

  // C) Posting Executive Mark as Posted
  await logout(page);
  await login(page, credentials.posting);

  const postCard = page.locator(`div.rounded-lg:has-text("${clientBrand}")`).first();
  const markAsPosted = postCard.getByRole("button", { name: "Mark as Posted" });
  await expect(markAsPosted.first()).toBeVisible();
  await markAsPosted.first().click();

  await expect(page.getByText("Completed").first()).toBeVisible();

  // Backend evidence
  const postingTokenHeader = getRangreelTokenHeaderFromCookies(await page.context().cookies());
  const postingRes = await request.get(
    `${API_BASE_URL}/user/my-tasks?month=${encodeURIComponent(currentMonth)}`,
    {
      headers: {
        Cookie: postingTokenHeader,
      },
    }
  );
  expect(postingRes.ok()).toBeTruthy();
  const postingBody = await postingRes.json();
  expect(postingBody.success).toBe(true);

  const postingTasks = postingBody.data || [];
  const postStagesForBrand = postingTasks
    .filter((t) => t.clientBrandName === clientBrand)
    .flatMap((t) => t.stages || [])
    .filter((s) => String(s.stageName || "").toLowerCase() === "post");
  expect(postStagesForBrand.length).toBeGreaterThan(0);
  expect(postStagesForBrand[0].status).toBe("posted");

  const overallStatuses = postingTasks
    .filter((t) => t.clientBrandName === clientBrand)
    .map((t) => String(t.overallStatus || "").toLowerCase());
  expect(overallStatuses.some((s) => s === "posted")).toBeTruthy();
});

