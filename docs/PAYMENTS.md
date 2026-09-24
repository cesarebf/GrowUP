# GrowUP payment architecture

Status: conceptual only. Do not create Stripe resources or payment code yet. Amounts, percentages, plan benefits, currencies, and price options are configuration data, not constants embedded in business logic.

## Two independent subscription relationships

**Creator to GrowUP:** Stripe Billing collects the creator's platform subscription on GrowUP's platform account when their arrangement requires it. A creator plan defines platform entitlements and commercial terms. Whether billing covers one community or several remains unresolved.

**Member to community:** A member chooses a community tier and price. Stripe Billing and Connect eventually collect recurring membership payments and route creator revenue according to the selected Connect flow. This subscription is distinct from the creator's platform subscription, including its customer/account context, lifecycle, and cancellation policy.

| Arrangement | Community member billing | Creator platform billing | GrowUP platform transaction fee |
| --- | --- | --- | --- |
| Model A | Paid membership; multiple tiers/prices supported | Recurring monthly subscription | 0% on member subscriptions |
| Model B | Paid membership; multiple tiers/prices supported | No required monthly subscription to start | Configurable percentage of membership transactions |
| Model C | Free membership | Recurring monthly subscription | None on free membership |

These are initial catalog configurations, not three hardcoded execution paths. Model creator subscription requirement, membership charging mode, fee policy, and entitlements separately, validating allowed combinations. Do not silently add a fourth commercial offering. Processing fees still apply to paid transactions; “0%” means GrowUP's platform transaction fee only. Who bears processing and other Stripe fees must be resolved.

## Membership tiers and billing periods

A tier describes benefits; a price describes how a member pays for those benefits. Support multiple prices per tier, with currency, amount, period, and effective version. Do not put a single price on the community. Keep creator plan prices separate from member tier prices.

Represent recurring periods with interval unit/count: weekly = week/1, monthly = month/1, semiannual = month/6, yearly = year/1. Stripe exposes interval and interval count on [recurring prices](https://docs.stripe.com/api/prices/create). These are required supported options, not a requirement for every creator to offer all four. Creator subscriptions start monthly; the model can accommodate later configured periods.

Use explicit entitlement grants and effective tier assignments. Decide tier inheritance, concurrent tiers, proration, trials, discounts, grandfathering, grace periods, and upgrade/downgrade timing before implementing them. Keep free membership usable without a Stripe subscription.

## Connect and platform fees

Maintain an explicit mapping between a creator billing account, its authorized communities, and Stripe connected account context. Do not assume one connected account per community. Require appropriate onboarding/capabilities before enabling paid sales.

Do not choose direct charges, destination charges, or separate charges and transfers yet. That choice affects fund flow and responsibility for fees, refunds, and disputes; settle it using the intended business model and launch geography. See [Stripe Connect charge types](https://docs.stripe.com/connect/charges).

A versioned fee policy records the applicable rate, calculation basis, and effective dates. Server code resolves it from trusted community/commercial data and maps it to the chosen Connect application-fee mechanism. Never trust a client-supplied fee, amount, destination, or Stripe price ID. Preserve the applied terms and actual monetary results for reconciliation; changing plans must not rewrite transaction history.

Define whether fees apply before/after discounts or taxes, how rounding works, and how refunds/disputes reverse fees/transfers. Treat processor fees, platform application fees, taxes, and creator proceeds as distinct amounts. Invoicing and Tax remain optional capabilities pending billing and jurisdiction requirements.

## Reliable lifecycle processing

Verify webhook signatures against the raw request body. Persist verified event receipt and processing state durably; deduplicate by event/account/environment and make database effects idempotent. Handle retries and out-of-order delivery by reconciling authoritative provider state. Acknowledge only after durable acceptance; record failures and retry them. Stripe documents signatures and delivery behavior in its [webhook guide](https://docs.stripe.com/webhooks).

Bind provider objects to trusted local records and the correct connected account before changing access. Use idempotency keys for outgoing operations. Checkout redirects alone never grant paid benefits. A local entitlement projection supports access checks without calling Stripe on every request; webhook processing and periodic reconciliation keep it current. Select a durable retry mechanism before implementation.

## Decisions required before Stripe implementation

- Launch countries/currencies, seller/merchant responsibilities, tax obligations, and Connect account configuration/onboarding/charge flow; obtain appropriate business/legal review.
- Creator billing scope, actual plan prices/rates/limits, fee calculation basis, and migration between arrangements.
- Customer/product/price placement across platform/connected accounts, account ownership transfer, payout timing, fee payer, and handling restricted/disconnected accounts.
- Refund/dispute liability, negative balances, tax collection/remittance, invoice needs, and payment-method support for the required periods.
- Member delinquency/access policy and effects of creator delinquency on already-paying members; avoid accidentally tying the two lifecycles together.
