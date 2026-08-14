// vp-CD-6 (adversarial skeptic): "cards reachable from the editor". The
// recorded pass verified the card screen's DOM state after opening a card from
// the editor's "Cards in this scene" sheet — but DOM reads don't prove the
// screen is usable. Screens are stacked with fixed z-indexes (#scr-card
// z-index:4 < #scr-editor z-index:5, L92-93) and a screen left "under" keeps
// visibility:visible with translateX(-26%) (L88). Opening a card FROM the
// editor therefore leaves the editor painted ON TOP of the card screen.
// This probe hit-tests and screenshots the real stacking.
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
console.log('vp-CD6-card-over-editor VERDICT:', occluded || !backClickable ? 'DEFECT CONFIRMED — card screen unusable when opened from the editor' : 'NO DEFECT');
console.log('pageerrors:', errs.length ? errs : 'none');

await browser.close();
await srv.close();
