// Interview credits: balance, packs bought through Stripe Checkout, and the credit history.
import { h, mount, fmt, toast, confirmDialog } from '../lib.js';
import { state, hr, pageHead, loading, errorBox, plural } from './core.js';
import { setCrumbs, updateCredits } from './app.js';

const KIND = { free_grant: 'Free interviews', purchase: 'Credits bought', invite: 'Invitation sent' };

export async function render(el, _params, query = {}) {
  setCrumbs('Credits and billing');
  if (state.workspace !== 'own') {
    return mount(el, pageHead('Credits and billing'), h('div', { class: 'notice' }, 'The demonstration workspace has unlimited credits. Switch to “My workspace” in the sidebar to see your balance and buy credits.'));
  }
  mount(el, loading());
  try {
    if (query.paid) {
      const r = await hr('/api/hr/billing/confirm', { method: 'POST', body: { sessionId: query.paid } });
      history.replaceState(null, '', '#/billing');
      if (r.status === 'paid') toast(r.duplicate ? 'Payment received. Your credits were already added.' : `Payment received. ${plural(r.entry.delta, 'credit')} added.`, { timeout: 8000 });
      else toast('Your payment is still being confirmed. Credits are added as soon as Stripe confirms it.', { timeout: 9000 });
      await updateCredits();
    } else if (query.cancelled) {
      history.replaceState(null, '', '#/billing');
      toast('Checkout cancelled. You have not been charged.');
    }
  } catch (err) { toast(err.message, { kind: 'bad' }); }
  let b;
  try { b = await hr('/api/hr/billing'); } catch (err) { return mount(el, errorBox(err, () => render(el, [], {}))); }

  const buy = async (pack, btn) => {
    btn.disabled = true;
    try {
      const r = await hr('/api/hr/billing/checkout', { method: 'POST', body: { pack: pack.id } });
      if (r.url) { location.href = r.url; return; }
      const ok = await confirmDialog('Test purchase', `Stripe is not connected yet, so this adds ${pack.credits} credits without taking a payment. Once Stripe keys are added, this button opens Stripe Checkout instead.`, { confirmLabel: `Add ${pack.credits} test credits` });
      if (!ok) return;
      await hr('/api/hr/billing/simulate', { method: 'POST', body: { pack: pack.id } });
      toast(`${pack.credits} test credits added.`);
      await updateCredits();
      render(el, [], {});
    } catch (err) { toast(err.message, { kind: 'bad' }); } finally { btn.disabled = false; }
  };

  const best = Math.min(...b.packs.map((p) => p.usd / p.credits));
  mount(el,
    pageHead('Credits and billing', 'One credit sends one interview invitation. Reminders, previews and reports are free.'),
    h('div', { class: 'stack', style: { gap: '1.25rem', maxWidth: '960px' } },
      b.payments === 'simulated' ? h('div', { class: 'notice demo' }, 'Payments are in test mode: Stripe is not connected yet, so buying a pack adds credits without charging.') : null,
      b.payments === 'test' ? h('div', { class: 'notice demo' }, 'Stripe test mode: use card 4242 4242 4242 4242 with any future date and CVC. No real payment is taken.') : null,
      h('section', { class: 'card row between', style: { alignItems: 'center' } },
        h('div', h('div', { class: 'small muted' }, 'Available credits'), h('div', { class: 'balance' }, b.balance)),
        h('p', { class: 'small ink2', style: { margin: 0, maxWidth: '420px' } }, b.balance
          ? `You can send ${plural(b.balance, 'more invitation')}. A credit is used when an invitation is sent, not when it is prepared.`
          : 'You have used all your credits. Buy a pack to send more invitations. Prepared invitations wait until you have credits.')),
      h('section', { class: 'stack' }, h('h2', 'Buy credits'),
        h('div', { class: 'packs' }, b.packs.map((p) => {
          const btn = h('button', { class: 'btn primary', type: 'button', onclick: () => buy(p, btn) }, `Buy ${p.credits} credits`);
          return h('div', { class: 'card pack' },
            h('strong', plural(p.credits, 'interview')),
            h('div', { class: 'price' }, `$${p.usd}`),
            h('div', { class: 'per' }, `$${(p.usd / p.credits).toFixed(2)} per interview`),
            p.usd / p.credits === best ? h('span', { class: 'badge accent' }, 'Best value') : h('span', { class: 'badge', style: { visibility: 'hidden' } }, '-'),
            btn);
        })),
        h('p', { class: 'small muted', style: { margin: 0 } }, 'Prices in US dollars. Payment is handled by Stripe; PartWays never sees your card details. Credits do not expire.')),
      h('section', { class: 'card stack' }, h('h3', 'History'),
        b.ledger.length ? h('div', { class: 'table-wrap' }, h('table',
          h('thead', h('tr', ['Date', 'What', 'Credits'].map((c) => h('th', c)))),
          h('tbody', b.ledger.map((e) => h('tr',
            h('td', fmt.dateTime(e.at)),
            h('td', KIND[e.kind] || e.kind, e.kind === 'invite' && e.interviewId ? h('span', { class: 'mono small muted' }, ` ${e.interviewId}`) : null, e.simulated ? h('span', { class: 'badge demo', style: { marginLeft: '.35rem' } }, 'test') : null, e.amountUsd && !e.simulated ? h('span', { class: 'small muted' }, ` · $${e.amountUsd}`) : null),
            h('td', { class: 'num' }, e.delta > 0 ? `+${e.delta}` : e.delta))))))
          : h('p', { class: 'muted' }, 'No credit activity yet.'))));
}
