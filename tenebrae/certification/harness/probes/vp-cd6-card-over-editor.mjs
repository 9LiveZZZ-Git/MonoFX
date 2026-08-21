// vp-CD-6 (adversarial skeptic): "cards reachable from the editor"
// (CD-6, certification/step1-requirements.md L55). DOM reads don't prove the
// screen is usable, so this probe hit-tests and screenshots the real stacking.
//
// CONTRACT UPDATE (2026-08 triage): this probe was written against the FIXED
// CSS z-index hierarchy (#scr-card z-index:4 < #scr-editor z-index:5,
// step1.html L92-93), under which opening a card FROM the editor left the
// editor painted on top ('.screen.under' keeps visibility:visible,
// translateX(-26%), L88). The artifact replaced that hierarchy: applyNav()
// (step1.html L1120-1133) now assigns z-index from the NAVIGATION STACK order —
//   // stacking must follow the navigation order, not the fixed CSS hierarchy —
//   // editor→card layers the card above the editor it was opened from
//   el.style.zIndex = idx > -1 ? String(idx + 1) : '';
// so the inline style overrides the stylesheet and the card wins.
// The assertion is therefore inverted to the governing contract: the card
// screen opened from the editor must be on top, hit-testable, and leavable.
// Same measurements, same rigour; only the expected sign changed.
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errs = [];
page.on('pageerror', e => { errs.push(e.message); console.log('PAGE EXCEPTION:', e.message); });

await page.goto(srv.url + 'step1.html');
await page.waitForTimeout(700);
await page.click('#lib-new'); await page.waitForTimeout(400);
await page.fill('#ps-input', 'Occlusion Book'); await page.click('#ps-save');
await page.waitForTimeout(800);

// prose that mentions a card name
await page.click('#ed-content');
await page.keyboard.type('Serane walked to the harbor.');
await page.waitForTimeout(1600);

// make the card via book screen (clean route)
await page.click('#ed-back'); await page.waitForTimeout(600);
await page.click('#bk-cardsrow'); await page.waitForTimeout(600);
await page.click('#cd-new'); await page.waitForTimeout(450);
await page.fill('#ps-input', 'Serane'); await page.click('#ps-save');
await page.waitForTimeout(700);
// back to editor: card -> cards -> book -> scene
await page.click('#cc-back'); await page.waitForTimeout(500);
await page.click('#cd-back'); await page.waitForTimeout(500);
await page.locator('#bk-list [data-scene]').first().click(); await page.waitForTimeout(700);

// editor ⋯ -> Cards in this scene -> Serane (the recorded CD-6 route)
await page.click('#ed-more'); await page.waitForTimeout(450);
await page.locator('#sheet button', { hasText: 'Cards in this scene' }).click();
await page.waitForTimeout(500);
await page.locator('#sheet button', { hasText: 'Serane' }).click();
await page.waitForTimeout(900);

const stacking = await page.evaluate(() => {
  const card = document.querySelector('#scr-card');
  const ed = document.querySelector('#scr-editor');
  const back = document.querySelector('#cc-back');
  const br = back.getBoundingClientRect();
  const hitBack = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
  const hitMid = document.elementFromPoint(195, 420);
  const within = (el, root) => root.contains(el);
  return {
    cardClasses: card.className, edClasses: ed.className,
    cardZ: getComputedStyle(card).zIndex, edZ: getComputedStyle(ed).zIndex,
    edVisibility: getComputedStyle(ed).visibility,
    edTransform: getComputedStyle(ed).transform,
    backHitLandsInCardScreen: within(hitBack, card),
    backHitLandsInEditor: within(hitBack, ed),
    midHitLandsInCardScreen: within(hitMid, card),
    midHitLandsInEditor: within(hitMid, ed),
    ccBartitle: document.querySelector('#cc-bartitle').textContent,
  };
});
console.log(JSON.stringify(stacking, null, 1));
await page.screenshot({ path: '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/vp-cd6-occlusion.png' });

// Can the user actually leave the card screen? Try the real back button.
let backClickable = true;
try{ await page.click('#cc-back', { timeout: 3000 }); }catch(e){ backClickable = false; }

const occluded = stacking.backHitLandsInEditor || stacking.midHitLandsInEditor;
console.log('card screen state opened:', stacking.ccBartitle === 'Serane');
console.log('card screen occluded by editor (hit-test):', occluded);
console.log('#cc-back clickable:', backClickable);
console.log('pageerrors:', errs.length ? errs : 'none');

const checks = [];
const ok = (label, cond) => { checks.push(!!cond); console.log((cond ? 'ok  ' : 'FAIL'), label); };
ok('card opened from the editor route', stacking.ccBartitle === 'Serane' && /\bon\b/.test(stacking.cardClasses));
ok('editor is left "under" and still painted (the occlusion risk is real)',
   /\bunder\b/.test(stacking.edClasses) && stacking.edVisibility === 'visible');
ok('nav-order stacking puts the card above the editor it was opened from',
   Number(stacking.cardZ) > Number(stacking.edZ));
ok('card back button hit-tests into the card screen, not the editor',
   stacking.backHitLandsInCardScreen && !stacking.backHitLandsInEditor);
ok('card body hit-tests into the card screen, not the editor',
   stacking.midHitLandsInCardScreen && !stacking.midHitLandsInEditor);
ok('the user can actually leave the card screen', backClickable);
ok('no page exceptions', errs.length === 0);
console.log('vp-CD6-card-over-editor VERDICT:', checks.every(Boolean) ? 'PASS' : 'FAIL');

await browser.close();
await srv.close();
