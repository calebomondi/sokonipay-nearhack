# Test SokoniPay the way a judge will

You are testing a web app called SokoniPay. Work only in the browser. Do not open or change any files or code, and do not try to fix anything. Follow the steps, compare what you see with what is expected, and write the report described at the end.

Hackathon judges will follow the "Try it as a judge" section of the project's README, step by step, on a fresh account. This test follows the same path, so it checks two things at once: that the app works, and that every README step says exactly what a judge will see. When the screen says something different from the expected result, even if the app is working, report the exact words on screen.

## Background

SokoniPay gives a business an AI agent that sells for it, and a customer an AI agent that pays for them. Businesses price in Kenya shillings (KES). Each payment settles in demo dollars ("sUSD") on the NEAR test network. No real money is involved.

| Site | Address |
|---|---|
| User app | https://sokonipay.up.railway.app |
| Business console | https://merchant-sokonipay.up.railway.app |
| Daily statement | the console address + `/statement` |

Accounts:

- Use **one Google account that has never signed in to SokoniPay**. This is the judge. You use it as a customer in Part A and to open a business in Part B. If you only have accounts that have used SokoniPay before, use one, say so at the top of the report, and expect a different starting balance.
- Do not use the admin page, and do not ask anyone to verify the business for you: the point is that a judge can do it alone.

These businesses already exist and are verified: "Nairobi Arboretum" (a venue), "Mama Njeri's Kitchen" (a food stall), "Kilimani Service Station" (a counter: Diesel KES 125 a litre) and "Kasarani Fibre" (an internet provider with monthly plans).

How to work:

- Sign-in is "Continue with Google" on both sites.
- Steps that write to the NEAR network take 3 to 20 seconds. An order placed by chat takes 30 to 60 seconds. Wait up to 90 seconds before calling something stuck.
- When a step fails, copy the exact words on screen, try once more, then carry on with the next step that does not depend on it.
- Note how long each step takes, from the click to the result.
- Keep a list of every amount spent, added and refunded.
- One dollar is about KES 130, so a shilling amount can be off by KES 1.

## Part A. As a customer (user app)

### A1. Sign in
Open the user app and sign in with the judge account. Expect a balance of about KES 6,500 (50 demo dollars) and a card "Agent spend limit today". Write down the balance and the two limits shown.

### A2. Buy tickets
Home → "All shops" → "Nairobi Arboretum" → pick 2 Adult → "Get 2 tickets". Expect the two agents' conversation, then a green ticket with a ticking clock and a QR code. The balance drops. Click "See the payment on NEAR": expect a NEAR explorer page for the transaction.

### A3. The contract refuses
On the same page pick 20 Adult and buy. Expect a red box "The contract refused this payment", naming the per-payment limit. Nothing is paid and the balance does not change. A link opens the refused transaction.

### A4. Change the limit
Home → "Limits" → lower the per-payment limit to KES 300 → save. Go back to the Arboretum and buy 2 Adult again. Expect the contract to refuse it now. Then set the per-payment limit back to what it was in A1.

### A5. Pay at a counter by naming the money
"Kilimani Service Station" → pick Diesel → type `1500`. Expect "KES 1,500 buys 12 litres of Diesel at KES 125 a litre." Pay. Expect a pass with a three-digit code and "Ready to collect". Write the code down.

### A6. Chat
"Chat" → type `Get me 2 adult tickets at the Arboretum`. Expect the agent to find the venue and agree a price, then stop at "Shall I pay?". Check that nothing is paid yet. Open the agent-to-agent conversation and read it. Tap "Not now". Expect "You said no, so nothing was ordered or paid."

### A7. Voice (you cannot speak, so check what you can)
Still in Chat. If there is no microphone button and no speaker icon, write "voice not shown" and go to A8.
1. Tap the speaker icon at the top. Expect it to turn on (blue).
2. Tap the microphone button. Your browser may ask for the microphone: allow it.
   - If the browser has no microphone, expect "The microphone isn't available. Allow it in your browser, or type instead."
   - If it has one, expect the button to turn red and the box to say "Listening… stop talking to send". Say nothing. Expect it to stop by itself after about 6 seconds with "I didn't hear anything. Tap the microphone and speak, or type instead." Nothing is sent.
3. Tap the microphone again, then tap it a second time straight away. Expect it to stop at once.
4. Type `What's my balance?` and send. Expect an answer with the balance. A "Listen" link appears under the answer. You can't hear sound, so don't report on it.

### A8. A meal for two
"Mama Njeri's Kitchen" → choose 2 people → type `lunch for two` → order. Expect the agents to agree a meal. If the order meets a discount rule, expect the stall's agent to give the full discount the rule allows and to name the rule (for example 10% for a group). Write down the discount and the rule named. Expect "Your share is paid. Waiting for 1 more." and a link for a friend. Do not pay the second share.

### A9. A monthly plan
"Kasarani Fibre" → subscribe to the cheapest plan. Expect an in-app confirmation (not a browser pop-up), then "Subscribed" and the first bill paid. Open "Subs": the plan is Active with a next payment date. Pause it, then resume it, then cancel it. Expect each to work and no second bill.

### A10. Add money
Home → "Add money" → pick any chain and stablecoin → 25. Expect a live quote. Click "Try it with demo money". Expect a result like "+24.99" that matches the amount on the button you clicked, and the balance to rise by that amount.

### A11. Activity
Open "Activity". Expect every step above that moved money: the Arboretum tickets, the diesel, the meal share (marked as held until everyone has paid), the Kasarani bill, and the money added. Money out is red, money in is green. Check that the balance matches your own list.

## Part B. As a business (console)

### B1. Open a counter
Open the console and sign in with the judge account. Choose "A counter or till". Name it `Judge Test Kiosk`, place `Westlands, Nairobi`, description `A test kiosk opened by the judge script.` Click "Open my counter". Expect a live preview while you fill it in, then "Opening your shop" for about 25 seconds, then the console.

Open the "Price list" tab and add one item: name `Bread`, price `65`, for each `loaf`, tick "Whole only", then "Add item". Expect only that button to say "Saving…", then the row "Bread · 65 · loaf, whole only".

### B2. Not verified yet
Expect "Not verified yet" beside the name, a banner "Waiting for SokoniPay to verify your shop", and no code. In the user app, "All shops" must not list Judge Test Kiosk.

### B3. Verify it yourself
In the banner, click "Verify my shop (demo)". Expect "Verifying on NEAR…", then the banner goes away, the name gets a checkmark and the shop's code appears. If there is no such button, write that down: it means the hosted demo is not set up for judges, and the README is wrong. Then skip to B8.

### B4. Sell to yourself
In the user app, "All shops" → "Judge Test Kiosk" → pick Bread → type `200`. Expect "KES 200 buys 3 loaves of Bread…" and that it charges KES 195, not KES 200. Pay. Expect a pass with a code. Keep that page open.

Back in the console, without reloading: expect the sale in Today, in the sales chart, and on the "To hand over" list with the same code.

### B5. Hand it over
In the console, click "Handed over" on that sale. Expect "Handed over to … (code …)" and the sale to say "Can't refund: handed over". On the user app page you kept open, expect the pass to change to "Collected" within about 10 seconds, without a reload.

### B6. A refund
In the user app, buy Bread for `65` once more. In the console, refund that sale before handing it over. Expect an in-app confirmation, then "Refunded". In the user app's Activity, expect the refund in green.

### B7. Ask the business's agent
Click "Ask your agent". Expect a panel to slide in with the cursor already in the box. Type straight away `How did we do today?` and send. Expect an answer that matches the console's figures (2 sales, 1 refunded). Check the microphone button behaves as in A7 if it is there.

### B8. Read payments aloud
On the till, click "Read payments aloud". Expect it to turn blue and say "Reading payments aloud". You can't hear sound, so don't report on it. Click it again to turn it off.

### B9. Split a sale
"Settings" → "Split every sale" → 10 to savings → "Save split". Expect "Saved. The next sale is split this way." In the user app, buy Bread for `65` once more. In the console, expect a Savings card with about KES 6. Open "Daily statement": expect the sales, the earlier refund as a row with a minus sign, "Net for the day" equal to sales less the refund, and the split under "Where the sales went". Then set the split back to 0 and save.

## Do not test

- Real deposits or withdrawals with real coins.
- The camera.
- The admin page.
- Do not suspend, refund or change anything in the four existing businesses.

## Your report

**1. Summary.** Three or four sentences: how far you got, what works, the most serious problems, and plainly what you could not test.

**2. Results.** One row per step: A1 to A11, B1 to B9.

| Step | Result | What you saw |
|---|---|---|
| A1 | Pass / Fail / Partly / Skipped | One line. For anything but a pass, the exact words on screen. |

**3. Where the README is wrong.** Every place the screen said or did something different from the expected result above, even when the app worked. Quote what you expected and what the screen said.

**4. Problems, most serious first.** For each: which site and step, what you did just before, what you expected, what happened, the exact error text, and whether it happened again on a second try.

**5. Timings.** Signing in to a first balance (A1), a ticket purchase (A2), a counter payment (A5), a chat purchase up to "Shall I pay?" (A6), opening a business (B1), verifying it (B3), a sale reaching the console (B4), the pass turning to "Collected" (B5).

**6. Money check.** The judge's starting balance, every amount spent, added and refunded, the balance you expected and the balance shown. The same for Judge Test Kiosk.

**7. What you left behind.** Anything you changed and did not put back (limits, splits, subscriptions, the new business, the unfinished meal for two).

**8. Anything unexpected.**
