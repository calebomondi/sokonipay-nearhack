# Retest SokoniPay: the fixes and the new features only

You are testing a web app called SokoniPay. Work only in the browser. Do not open or change any files or code, and do not try to fix anything. Follow the steps, compare what you see with what is expected, and write the report described at the end.

This is a short retest. It covers what changed since the last full test: a new way to pay at a counter, an internet provider with monthly plans, and the fixes to the problems the last test found. Don't repeat the rest of the full script.

## Background

SokoniPay lets a customer's AI agent pay a shop's AI agent. Shops price in Kenya shillings (KES). Each payment settles in demo dollars ("sUSD") on the NEAR test network. No real money is involved.

| Site | Address |
|---|---|
| User app | https://sokonipay.up.railway.app |
| Merchant console | https://merchant-sokonipay.up.railway.app |
| Daily statement | the console address + `/statement` |
| Admin page | the console address + `/admin` |

**The data from the last test is still there.** Use it; don't create it again.

- The **admin** Google account owns "Nairobi Arboretum" (a venue) and "Kilimani Service Station" (a counter), and is also the user who pays in this test.
- The **second** Google account owns "Mama Njeri's Kitchen" (a food stall).
- The shops no longer have "(demo)" in their names. The Arboretum is open 06:00 to 23:59 and has no revenue split. Kilimani has a price list: Diesel KES 125 a litre, Petrol KES 180 a litre, Engine oil KES 900 a bottle (whole only).

How to work:

- Sign-in is "Continue with Google" on both sites.
- Steps that write to the NEAR network take 3 to 20 seconds. An order placed by chat takes 30 to 60 seconds. Wait up to 90 seconds before calling something stuck.
- When a step fails, copy the exact words on screen, try once more, then carry on with the next step that does not depend on it.
- Keep a list of every amount spent, added and refunded.
- All times are Nairobi time (UTC+3). One dollar is about KES 130, so a shilling amount can be off by KES 1.

---

## Part A. Get ready (user app, admin account)

### A1. Money
1. Note the balance. Click "Add money", pick Base, USDC, `25`, and use the demo button. Expect the balance up by about KES 3,250 within a few seconds of "Done". Type letters into the amount box: they must not appear.
2. If the balance is under KES 12,000, say so in the report and carry on; some later steps may then show "Needs money".

### A2. Limits, shown as typed
1. Click "Limits". Set per payment `5000` and per day `30000`. Save.
2. Expect the sheet to close and the card to show the new figures **at once**: "of KES 30,000" and "Up to KES 5,000 per payment." Exactly those figures, not KES 5,003 or KES 30,015.
3. Reload the page. Expect the same exact figures.

---

## Part B. An internet provider with monthly plans

A business that sells nothing over a counter: home internet at three speeds, billed monthly. The second account opens it, the admin verifies it, and the user subscribes.

### N1. Open the provider and verify it
1. Sign in to the console with the second account (the stall's owner). Open the shop switcher and click "Open another shop". Pick "A counter or till".
2. Name it `Kasarani Fibre`, place `Kasarani, Nairobi`, description `Home internet on fibre. Pick a speed, pay monthly, cancel any time.` Click "Open my counter". Expect the new shop's console in about 25 seconds, "Not verified yet".
3. Sign in to the console with the admin account, open "Admin" and click "Verify shop" on Kasarani Fibre. Expect "Approved". Sign back in with the second account and switch to Kasarani Fibre.

### N2. Add the plans
1. Open "Subscriptions". Add three plans, each "every month": `Home 10 Mbps` at `2500`, `Home 30 Mbps` at `4000`, `Home 100 Mbps` at `7000`.
2. Expect all three listed cheapest first, each with its price, "a month" and "0 subscribers".
3. Try to add a plan with the price `0`. Expect the "Add plan" button greyed.

### N3. Subscribe as the user
1. In the user app (the user account), check the balance is at least KES 12,000 and the limits are as set in A2.
2. Open "All shops" and then Kasarani Fibre. Expect the header card with the description, then a "Subscriptions" card with the three plans and their monthly prices.
3. Click "Subscribe" on `Home 30 Mbps`. Expect an in-app sheet "Subscribe to Home 30 Mbps?" naming KES 4,000 a month. Click "Cancel": nothing happens. Click "Subscribe" again and confirm. Expect "Subscribed. View" within about 20 seconds.
4. Open "Subs". Expect "Home 30 Mbps", "Kasarani Fibre · KES 4,000 a month" and a green "Active". Open it. Within about a minute expect the first payment, "−KES 4,000" in red, and "Next payment" about one month ahead.
5. Expect the balance down by KES 4,000 and, in Activity, a "−KES 4,000" line marked "Home 30 Mbps, subscription".
6. Go back to Kasarani Fibre's page and click "Subscribe" on `Home 30 Mbps` again. Expect "You already have this subscription." and no second payment.

### N4. What the provider sees
1. In the provider's console (second account), open "Subscriptions". Expect `Home 30 Mbps` with "1 subscriber" and the other two with 0.
2. Open "Sales". Expect a paid sale of KES 4,000 from the user for "Home 30 Mbps". Overview's "Today" shows KES 4,000 and the Balance is up by the same.
3. Open the agent panel and ask `How many subscribers do I have?` Expect an answer naming one subscriber on Home 30 Mbps.

### N5. The contract's limits on the provider
1. Check the balance is still above KES 7,000. Subscribe to `Home 100 Mbps` (KES 7,000), which is over the KES 5,000 per-payment limit. Expect the subscription to appear in "Subs" and, within about a minute, the note "The contract refused the last payment: … Your agent tries again in an hour." **No** KES 7,000 is taken, and the provider's console lists a refused payment under "What your agent did".
2. Cancel `Home 100 Mbps`. Expect "Cancelled" and no payment for it afterwards.

### N6. Change speed, then leave
1. Subscribe to `Home 10 Mbps`. Expect a first payment of KES 2,500 within about a minute. Both `Home 30 Mbps` and `Home 10 Mbps` are now "Active".
2. Open `Home 30 Mbps` in "Subs" and click "Cancel". Expect an in-app sheet; confirm. Expect "Cancelled". The provider's console shows 0 subscribers on 30 Mbps and 1 on 10 Mbps.
3. Click "Pause" on `Home 10 Mbps`. Expect "Paused" and the note that your agent refuses bills until you resume. Click "Resume". Expect "Active" and no extra payment, because this month is already paid.
4. In the provider's console refund the KES 2,500 sale. Expect "Refunded" and the user's balance up by KES 2,500.

---

## Part C. Paying at a counter

At a counter the customer now names the money ("diesel for 1,500") and the shop's agent works out what it buys.

### S3. The till and the price list (console, admin account, Kilimani Service Station)
1. Switch to Kilimani Service Station. On Overview expect a "To hand over" card with a "Read payments aloud" button, and below it an "Or key in an amount" card.
2. Click "Read payments aloud". Expect the button to turn blue and, if the computer has speakers, a spoken "Sound is on."
3. Open "Price list". Expect Diesel (125, litre), Petrol (180, litre) and Engine oil (900, bottle, whole only). Add `Bread`, `65`, `loaf`, and tick "Whole only". Expect the button to say "Saving…" and then the new row with "loaf, whole only".
4. Click "Edit" on Petrol, change the price to `185` and save. Expect "Saving…" on the button until the row shows 185. The old price must not sit there looking unsaved.

### S4. The customer names the money (the main way to pay at a counter)
1. In the user app open the counter from "All shops". Expect the header card, then "How much do you want to spend?" with a button for each item showing its price ("KES 125 a litre").
2. Pick Diesel and type `1500`. Expect, within a second, a green line "KES 1,500 buys 12 litres of Diesel at KES 125 a litre." and the button "Pay KES 1,500". Letters typed into the amount box don't appear.
3. Pick Bread and type `200`. Expect "KES 200 buys 3 loaves of Bread at KES 65 a loaf. I'll charge KES 195, not KES 200." and "Pay KES 195". Type `50`. Expect a red line saying it doesn't cover one loaf, and the button greyed.
4. Go back to Diesel and `1500`, and pay. Expect the two agents' conversation (the shop's agent says what the amount buys), then a green pass "Ready to collect" with a three-digit code, "Diesel, 12 litres" and "Paid KES 1,500". The balance drops by KES 1,500.
5. In the console, without reloading: expect the sale under "To hand over" within about 5 seconds, with the same three-digit code, "Diesel, 12 litres" and the customer's name. If "Read payments aloud" is on, the payment is spoken.
6. In the sales list, expect "Refund in full" on this sale. Don't click it. Click "Handed over". Expect "Handed over to … (code …)", the row gone from "To hand over", and the sale now showing "Can't refund: handed over". In the user app the pass turns grey and says "Collected".
7. Buy Bread for `200` and, in the console, refund it before handing over. Expect "Refunded" and the user's balance back up by KES 195.

### S5. By chat
1. In the user app's Chat type `Get me diesel for 1,000 at Kilimani`. Expect the confirmation card with "Kilimani Service Station says: KES 1,000 buys 8 litres of Diesel at KES 125 a litre." and a total of KES 1,000. Click "Not now". Expect "You said no, so nothing was ordered or paid."
2. Send it again and click "Yes, pay". Expect the green pass with a code, and a reply that tells you the code to show the cashier.

### S6. The cashier keys in the amount (for a sale where the amount isn't known first)
1. In the console's "Or key in an amount" card type `800` and `Puncture repair`, click "Ask for payment". Expect "KES 800, Puncture repair, Waiting for the customer to scan" with a code and "Cancel".
2. In the user app open the counter. Expect a card "The cashier asks for: Puncture repair", "KES 800" and "Pay KES 800" above the buy-by-amount card. Pay. Expect a receipt, and in the console the amount gone from the waiting list and a paid sale.
3. Key in another amount and click "Cancel". Expect it gone from the user's page within about 5 seconds.

---

## Part D. The fixes

### D1. Confirmations are part of the app
Every "are you sure?" in parts B and C should have been a sheet drawn by the app: from the bottom edge on a narrow window, centred on a wide one. Report any browser dialog (a grey system box). Check one more: in the user app's Chat, open "Chats", click the bin on a chat. Expect an in-app sheet "Delete this chat?". Press Escape: it closes and nothing is deleted.

### D2. A refund that can't happen says so first (console, Nairobi Arboretum)
1. In the user app buy 2 Adult tickets at the Arboretum. If the venue is closed, the ticket is for its next opening; that is fine for this step.
2. In the console, under "At the gate", check that ticket and click "Just one". Expect "Let in. 1 of 2 are now in."
3. Look at that sale in the list, on Overview and on "Ticket sales". Expect no refund button: in its place "Can't refund: 1 of 2 already in".
4. After "Check", the list of recently sold tickets under the box should stay where it is, so the buttons don't jump.

### D3. Sales figures are what was paid
1. In the console note the Adult row under "What sells" (number sold and KES) and the "Today" card.
2. In the user app buy 5 Adult tickets. Expect the shop's agent to give 10% off for a group of 5: KES 1,125.
3. In the console, **without reloading**, expect within about 10 seconds: "Today" up by KES 1,125 and one more sale, "Customers today" at least 1, and Adult under "What sells" up by 5 tickets and by KES 1,125 (not KES 1,250).
4. Open the agent panel and ask `What sells best, and for how much?` Expect figures that match "What sells". Ask `How do I refund a sale?` Expect it to name "Ticket sales".

### D4. A ticket bought while the venue is closed
1. In the console click "Edit" on the Arboretum's profile and set the hours to `00:00` to `00:01`. Save. Expect "Saving…", then "Closed now" on the card.
2. In the user app open the Arboretum. Expect "Closed" in the header, and a note that a ticket bought now is for tomorrow. The ticket picker is still there. Pick 1 Adult. Expect the button "Get my ticket for tomorrow".
3. Buy it. Expect a green ticket that says "Valid tomorrow" and names the closing time tomorrow. It must not be expired.
4. In the console set the hours back to `06:00` to `23:59` and save.

### D5. A vague order for two (user app, Mama Njeri's Kitchen)
1. Choose 2 people and type `lunch for two`. Expect the agents to settle on dishes, then "Your share is paid. Waiting for 1 more." and a link. It must not say the agents "didn't settle on an order". (You don't need to pay the second share; the first is returned when the bill expires.)
2. Look at the stall's page header. If it mentions a discount, sign in to the console with the second account, open the stall's "Settings" and expect the same rules listed there.

### D6. Savings and a partner's share (console, Nairobi Arboretum)
1. In "Settings" set the split to `10` savings and `10` partner. Save. Expect "Saved."
2. In the user app buy 1 Adult ticket (KES 250).
3. On Overview expect a Savings card and a Partner card, each about KES 25. Expect "Move to balance" on Savings only. The Partner card has no such button.
4. Click "Move to balance" on Savings. Expect Savings at KES 0 and the Balance up by the same.
5. Set the split back to `0` and `0` and save.

### D7. The console at a narrow width
Make the console window about 800 px wide. Expect the floating bar on two rows, with every section reachable: either all visible or the row scrolls sideways. Nothing is cut in half with no way to reach it. Switch between sections: the page must not shift sideways by a few pixels.

### D8. Wording
1. In Chat type `Get me 1 adult ticket at the Arboretum` and click "Not now" on the card. Expect "You said no, so nothing was ordered or paid."
2. In Chat type `Find me lunch under KES 500`. Expect the confirmation card to say why the agent chose that shop ("I chose it because …"). Click "Not now".
3. In Chat, on an empty new chat, expect "Agent: NEAR AI Cloud" with no model name after it. In the stall's console the line under the name must not show a model name either.
4. Open the Arboretum's daily statement. Expect refunds written "−KES 600" style, with the minus before "KES", never "KES-600".
5. Open the stall's daily statement for a day with a refund. Expect "Kept by the shop" to be the sales kept less the refunds.

### D9. Money out (try it; skip if your browser blocks it)
1. In the user app click "Withdraw", pick Base, USDC, `2`, an address of `0x1111111111111111111111111111111111111111`, and confirm. Expect the balance down by about KES 260 within 20 seconds and a red "Withdrawal" line in Activity. Letters typed into the amount box must not appear.
2. If your browser refuses to click the button because it is a financial action, say so and skip.

---

## Do not test

- Real deposits with real coins.
- The camera.
- Do not suspend a shop, and do not delete tickets, menu items or plans you did not add.

## Your report

**1. Summary.** Three or four sentences: how far you got, what works, the most serious problems, and plainly what you could not test.

**2. Results.** One row per step: A1, A2, N1 to N6, S3 to S6, D1 to D9.

| Step | Result | What you saw |
|---|---|---|
| A1 | Pass / Fail / Partly / Skipped | One line. For anything but a pass, the exact words on screen. |

**3. Problems, most serious first.** For each: which site and step, what you did just before, what you expected, what happened, the exact error text, and whether it happened again on a second try.

**4. Timings.** A counter payment (S4), the sale reaching "To hand over" (S4.5), a subscription's first payment (N3), a refund, a chat purchase (S5).

**5. Money check.** The user's starting balance, every amount spent, added, withdrawn and refunded, the balance you expected and the balance shown. The same for Kilimani Service Station and Kasarani Fibre.

**6. What you left behind.** Anything you changed and did not put back (hours, splits, limits, plans, new shops).

**7. Anything unexpected.**
