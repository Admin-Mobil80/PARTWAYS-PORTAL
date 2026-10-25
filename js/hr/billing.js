// Interview credits: balance, packs bought through Stripe Checkout, and the credit history.
import { h, mount, fmt, toast, dialog, confirmDialog } from '../lib.js';
import { state, hr, pageHead, loading, errorBox, plural } from './core.js';
import { setCrumbs, updateCredits } from './app.js';

const KIND = { free_grant: 'Free interviews', purchase: 'Credits bought', invite: 'Invitation sent', adjustment: 'Adjusted by PartWays' };

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

  // While self-service buying is off, credits are added by PartWays: no prices or packs here.
  const selfServe = b.selfServe !== false;
  const best = selfServe ? Math.min(...b.packs.map((p) => p.usd / p.credits)) : 0;
  mount(el,
    pageHead('Credits and billing', 'One credit sends one interview invitation. Reminders, previews and reports are free.'),
    h('div', { class: 'stack', style: { gap: '1.25rem', maxWidth: '960px' } },
      b.payments === 'simulated' ? h('div', { class: 'notice demo' }, 'Payments are in test mode: Stripe is not connected yet, so buying a pack adds credits without charging.') : null,
      b.payments === 'test' ? h('div', { class: 'notice demo' }, 'Stripe test mode: use card 4242 4242 4242 4242 with any future date and CVC. No real payment is taken.') : null,
      h('section', { class: 'card row between', style: { alignItems: 'center' } },
        h('div', h('div', { class: 'small muted' }, 'Available credits'), h('div', { class: 'balance' }, b.balance)),
        h('p', { class: 'small ink2', style: { margin: 0, maxWidth: '420px' } }, b.balance
          ? `You can send ${plural(b.balance, 'more invitation')}. A credit is used when an invitation is sent, not when it is prepared.`
          : selfServe ? 'You have used all your credits. Buy a pack to send more invitations. Prepared invitations wait until you have credits.'
            : 'You have used all your credits. Prepared invitations wait until you have credits.')),
      !selfServe ? h('section', { class: 'card stack' }, h('h3', { style: { margin: 0 } }, 'Need more credits?'),
        b.request
          ? h('p', { class: 'ink2', style: { margin: 0 } }, `You asked for ${b.request.credits ? plural(b.request.credits, 'more credit') : 'more credits'} on ${fmt.dateTime(b.request.at)}. The PartWays team will add them shortly; you can update the request if you need to.`)
          : h('p', { class: 'ink2', style: { margin: 0 } }, 'Credits are added by the PartWays team. Send a request and we will add them to your workspace.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => requestCredits(b, () => render(el, [], {})) }, b.request ? 'Update my request' : 'Request more credits'))) : null,
      !selfServe ? null : h('section', { class: 'stack' }, h('h2', 'Buy credits'),
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
            h('td', KIND[e.kind] || e.kind, e.kind === 'invite' && e.interviewId ? h('span', { class: 'mono small muted' }, ` ${e.interviewId}`) : null, e.simulated ? h('span', { class: 'badge demo', style: { marginLeft: '.35rem' } }, 'test') : null, selfServe && e.amountUsd && !e.simulated ? h('span', { class: 'small muted' }, ` · $${e.amountUsd}`) : null),
            h('td', { class: 'num' }, e.delta > 0 ? `+${e.delta}` : e.delta))))))
          : h('p', { class: 'muted' }, 'No credit activity yet.'))));
}

// Asks the PartWays team for credits while self-service buying is off.
function requestCredits(b, done) {
  const count = h('input', { type: 'number', id: 'rq-credits', min: 1, max: 1000, step: 1, placeholder: 'For example: 20', value: b.request?.credits ?? '' });
  const note = h('textarea', { id: 'rq-note', rows: 3, maxlength: 500, placeholder: 'Optional: anything we should know, such as when you need them' }, b.request?.note || '');
  dialog({
    title: 'Request more credits',
    body: h('div', { class: 'stack' },
      h('p', { class: 'small ink2', style: { margin: 0 } }, `You have ${plural(b.balance, 'credit')}. One credit sends one interview invitation. The PartWays team will get in touch and add the credits to your workspace.`),
      h('div', { class: 'field' }, h('label', { for: 'rq-credits' }, 'How many credits?'), h('span', { class: 'hint' }, 'Optional. Leave empty if you are not sure.'), count),
      h('div', { class: 'field' }, h('label', { for: 'rq-note' }, 'Note'), note)),
    actions: [
      { label: 'Cancel' },
      { label: b.request ? 'Update request' : 'Send request', kind: 'primary', onClick: async () => {
        const r = await hr('/api/hr/billing/request', { method: 'POST', body: { credits: count.value === '' ? null : Number(count.value), note: note.value } });
        toast(r.updated ? 'Request updated. The PartWays team has been told.' : 'Request sent. The PartWays team will add your credits shortly.');
        done();
      } },
    ],
  });
}
