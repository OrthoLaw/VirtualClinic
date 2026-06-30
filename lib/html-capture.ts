import type { CapturedEvidence } from "./types";
import { chromium, type Browser } from "playwright-core";

// Resolve a chromium executable for whatever environment we're in.
// - Serverless (Vercel) / CHROMIUM_REMOTE_PACK set: fetch @sparticuz/chromium-min pack.
// - Local dev (CHROMIUM_LOCAL=1 or a macOS Chrome present): use installed Chrome.
async function launch(): Promise<Browser> {
  const isServerless =
    !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

  if (!isServerless) {
    // Local: prefer the installed Chrome channel; no binary download needed.
    const macChrome =
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const executablePath =
      process.env.CHROMIUM_LOCAL && process.env.CHROMIUM_LOCAL !== "1"
        ? process.env.CHROMIUM_LOCAL
        : macChrome;
    return chromium.launch({
      headless: true,
      executablePath,
      args: ["--no-sandbox"],
    });
  }

  // Serverless: pull the slim chromium pack at runtime.
  const chromiumPack = (await import("@sparticuz/chromium-min")).default;
  const pack =
    process.env.CHROMIUM_REMOTE_PACK ||
    "https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar";
  const executablePath = await chromiumPack.executablePath(pack);
  return chromium.launch({
    headless: true,
    executablePath,
    args: chromiumPack.args,
  });
}

// DOM outline: the structural skeleton the persona reasons over alongside the screenshot.
// Runs in the browser context via page.evaluate (must be a real function, not a string).
function outlineInPage(): string {
  const out: string[] = [];
  const seen = new Set<string>();
  const sel =
    'h1,h2,h3,h4,button,a[href],input,select,textarea,label,[role="button"],[role="tab"],[role="dialog"],nav,table';
  document.querySelectorAll(sel).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const tag = el.tagName.toLowerCase();
    const anyEl = el as HTMLInputElement & HTMLElement;
    const text = (
      el.getAttribute("aria-label") ||
      anyEl.value ||
      anyEl.placeholder ||
      (el as HTMLElement).innerText ||
      ""
    )
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 80);
    const key = tag + "|" + text;
    if (seen.has(key)) return;
    seen.add(key);
    const role = el.getAttribute("role");
    out.push("[" + tag + (role ? ":" + role : "") + "] " + text);
  });
  return out.slice(0, 200).join("\n");
}

export async function captureHtml(url: string): Promise<CapturedEvidence> {
  let browser: Browser | null = null;
  try {
    browser = await launch();
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 1,
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }).catch(
      // some prototypes never reach networkidle; fall back to domcontentloaded
      async () => {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
      },
    );
    await page.waitForTimeout(1200); // let fonts/animations settle

    const shot = await page.screenshot({ fullPage: true, type: "png" });
    const structure = (await page.evaluate(outlineInPage)) ?? "";
    const title = await page.title();

    return {
      kind: "html",
      url,
      images: [{ label: title || "Rendered page", base64: shot.toString("base64") }],
      structure: structure.slice(0, 12000),
      note: `Rendered HTML at ${url} (full-page screenshot, 1280px wide). Single-page capture — interactive flows not driven in v1.`,
    };
  } finally {
    if (browser) await browser.close();
  }
}
