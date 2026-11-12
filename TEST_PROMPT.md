# Test SokoniPay in the browser: user end and merchant end

You are testing a web app called SokoniPay that runs on this computer. Work only in the browser. Do not open or change any files or code, and do not try to fix anything. Follow the steps, compare what you see with what is expected, and write the report described at the end.

## 1. Background

SokoniPay lets a customer's AI agent pay a shop's AI agent. Shops price in Kenya shillings (KES) and people see KES. Each payment settles in demo dollars ("sUSD") on the NEAR test network. No real money is involved anywhere.

| Site | Address | Who uses it | Window width |
|---|---|---|---|
| User app | http://localhost:5173 | Someone buying tickets or food | Any. The app sits in a phone-width column in the middle of the window. |
| Merchant console | http://localhost:5174 | A shop owner | Full width, 1280 px or more |
| Daily statement | http://localhost:5174/statement | A shop owner | Full width |
| Admin page | http://localhost:5174/admin | SokoniPay staff | Full width |

**Accounts and data that already exist.** This is not a clean start. Earlier tests left real data, and it should still be there:

- The **admin** Google account (ask the user which one if you are not told) has a user account and owns the venue "Nairobi Arboretum (demo)".
- A **second** Google account has a user account and owns the food stall "Mama Njeri's Kitchen (demo)".
- Both shops are verified. Both user accounts have a balance and earlier payments.

Rules the tests rely on:

- Sign-in is "Continue with Google" on both sites. Google shows an account chooser every time.
- Amounts are shown as "KES 1,274". Where the settlement amount matters, a small "sUSD" figure sits beside it. One dollar is about KES 130, and the rate is refreshed hourly, so a shilling amount worked out from dollars can be off by KES 1.
- The user's agent can only spend inside two limits the user sets: per payment and per day. The day is a rolling 24 hours, so yesterday evening's spending may still count.
- A ticket covers everyone it was bought for and stops working at the closing time written on it when it was sold.
- Only the owner can refund, withdraw or change limits. The agent cannot.
- All times are Nairobi time (East Africa Time, UTC+3).

How to work:

- **Write down the starting numbers** before you change anything: each user's balance, the "Agent spend limit today" line, and each shop's Balance card. All money checks are against these.
- Steps that write to the NEAR network take time. Most take 3 to 15 seconds. An order placed by chat takes 30 to 60 seconds. Wait up to 90 seconds before calling something stuck.
- When a step fails, copy the exact words on screen, try once more, then carry on with the next step that does not depend on it.
- Keep a list of every amount spent, added, withdrawn and refunded.
- Note the time each timed step takes.

Do the parts in order:

1. Part 1: user end, the new layout.
2. Part 2: merchant end, shilling prices.
3. Part 3: user end, tickets, limits, adding and withdrawing money.
4. Part 4: merchant end, the gate, refunds and the daily statement.
5. Part 5: the food stall, both ends (second Google account).
6. Part 6: checks across both sites.

---

## Part 1. User end: layout and navigation

Sign in to http://localhost:5173 with the admin account.

### U1. The frame
1. Make the window about 1280 px wide. Expect:
   - A background of faint outline shapes (triangles, rings, squares, crosses, arcs) scattered at different angles, with a soft violet tint top left and a green tint bottom right.
   - The app in a frosted column in the middle with rounded corners and a small gap above and below.
2. Scroll the content. Expect the background shapes not to move.
3. Make the window 400 px wide. Expect the column to fill the window edge to edge, with nothing cut off. Go back to full width.

### U2. Home
1. Expect, from the top:
   - Your Google profile photo in a circle (initials if the account has no photo), "Hi, <first name>" and the NEAR account name. There is no "Sign out" button in the header.
   - A "Balance" card: "KES" in small type, the amount large, and "… sUSD on NEAR" small underneath.
   - Four round buttons in the card: "Scan", "Add money", "Withdraw", "Limits".
   - If a ticket is still valid: "Ready to show" with one ticket row.
   - A card titled "Agent spend limit today" with "KES … of KES …", a bar, and one line: "Up to KES … per payment." Nothing else in that card.
   - "Shops" with up to 4 shops and "All shops".
   - "Recent payments" with at most 5 lines and "View all".
2. Scroll down. Expect the header and the whole Balance card to stay still while the rest scrolls beneath them.
3. Expect a pill-shaped bar floating at the bottom with five items: Home, Tickets, Subs, Chat, Activity. It must stay still while you scroll, and the list should fade out behind it. The current item is tinted and its icon is filled.
4. In "Recent payments", expect money out as red "−KES …" and money in as green "+KES …".

### U3. The profile menu
1. Click the profile photo. Expect a menu with: your name and email; a "NEAR account" box with "Copy" and "View on NEAR"; "Agent limits"; "Add money"; "Withdraw"; "Open my shop"; and "Sign out" in red at the bottom.
2. Click "Copy". Expect it to change to "Copied".
3. Press Escape. Expect the menu to close. Open it again and click outside it. Expect it to close.
4. Open it and click "Agent limits". Expect the limits sheet (see U8). Cancel it.
5. Do not sign out yet.

### U4. Shops
1. On Home click "All shops" (Shops is no longer in the bottom bar). Expect the title "Shops", your balance in small type, the profile photo on the right, a search box and a black "Scan" button. These stay still when the list scrolls.
2. Expect each shop to have a square icon with rounded corners and its initials, each shop in its own soft colour. A verified shop has a blue checkmark right after its name. There is no "Verified on NEAR" label.
3. Expect the venue's icon to carry a small dot: green when open, grey when closed.
4. Expect the shop you paid most recently to be first, and each shop you have paid to say "paid once" or "paid N times".
5. Type `arbor` in the search box. Expect only the Arboretum. Type `zzz`. Expect "No shop matches that. If you're at the shop, scan its code." Clear the box.

### U5. Tickets
1. Click "Tickets". Expect filter pills that stay still when the list scrolls: "All", "Active", "Used", "Expired", "Refunded", each with a count.
2. Expect every ticket row to be a white card that starts with a coloured rounded square:
   - green with a tick for an active ticket
   - grey for a used ticket
   - orange with a clock for an expired ticket
   - blue-grey with a return arrow for a refunded ticket
3. Click each filter. Expect only tickets of that kind, and the count on the pill to match the number of rows. An empty filter says "No <kind> tickets."
4. Click any ticket row. Expect the full ticket to open directly under that row, with the rows below sliding down smoothly. The page address must not change. The button on the row changes to "Hide".
5. Click a second ticket. Expect the first to close and the second to open.
6. Click "Hide". Expect it to close.

### U6. Activity
1. Click "Activity". Expect filter pills that stay still: "All", "Tickets", "Orders", "Money in", "Withdrawn".
2. Expect lines grouped under day headings such as "Today", "Yesterday" or "Wednesday 11 November", newest first, each with a time.
3. Expect "Money added" lines with a round green plus icon and a green "+KES …" amount.
4. Click each filter. Expect only matching lines.
5. Click a payment line. Expect its receipt or ticket page. Use the browser's back button to return.

---

### U6b. Chat with your agent
1. Click "Chat". Expect a focused screen: a header with "Chats", the chat's title, "New chat" and your profile photo; the messages; and the box to type in with a send button **at the very bottom** of the column. The bottom bar is not shown on this screen.
1a. Expect a slim handle on the left edge of the column, halfway down. Click it. Expect a narrow vertical bar to slide out with Home, Tickets, Subs, Chat and Activity stacked, Chat highlighted, and the rest of the screen dimmed. Click outside it. Expect it to slide back. Open it again and click "Home", then return to Chat from the bottom bar.
1b. Click "New chat". Expect the title "New chat" and a card "Ask your agent" with four suggestions.
2. Click "What's my balance?". Expect your message on the right, three moving dots, then within about 15 seconds an answer on the left with your balance and limits in KES. Check the figures against Home.
3. Type `Get me 2 adult tickets at the Arboretum` and send. Expect, in order:
   - small grey lines "Looking through verified shops" and "Talking to Nairobi Arboretum (demo)'s agent"
   - a card "Your agent and Nairobi Arboretum (demo)'s agent" that is open, showing the two agents' messages
   - a card outlined in colour: "Shall I pay Nairobi Arboretum (demo)?", "2 × Adult", the total in KES, "Not now" and "Yes, pay", and a countdown
4. Check Home in another tab or note the balance: **nothing must have been paid yet**.
5. Click "Not now". Expect "You said no. Nothing was paid.", then an answer from the agent saying nothing was paid. The balance is unchanged.
6. Send the same request again and this time click "Yes, pay". Expect the payment, a ticket shown in the chat, and an answer saying it paid. The balance drops by the ticket price.
7. On the conversation card click "Hide", then "Read". Expect it to fold and unfold smoothly.
8. Type `Find me something to eat under KES 500` (no shop named). Expect the agent to choose the food stall, say why, and stop at the "Shall I pay" card with a total of KES 500 or less. Click "Not now".
9. Type `Raise my daily limit to 50000`. Expect it to say it can't change limits and to point to Home. The limits must not change.
10. Reload the page and open Chat. Expect the same chat to open with its messages, and each order's conversation card closed and readable.
10a. Click "Chats". Expect a list of your conversations, newest first, each with a title from its first message and a date. A chat in which something was paid has a green dot and "paid for something". The open chat is outlined.
10b. Click an older chat. Expect its messages. Click "New chat", ask `What did I just buy?`. Expect the agent to answer from your payments, not from the other chat's messages.
10c. In "Chats", click the bin on a chat and confirm. Expect it gone from the list. Its payments must still be in Activity.
10d. **Voice (needs a microphone and speakers; skip if you have neither).** Expect a round microphone button left of the box to type in, and a speaker button in the header.
   - Click the microphone, allow it if the browser asks, say "What is my balance?" and click the red square. Expect "Working out what you said…", then your words appear as a normal message and the agent answers.
   - Click the speaker button so it is highlighted. Ask a question. Expect the answer to be read aloud, with shilling amounts spoken as "shillings". Click the speaker off: the audio stops, and later answers are silent.
   - Under any agent message click "Listen". Expect that message read aloud.
   - With the speaker on, ask for tickets. Expect the agent to ask aloud whether to pay. Saying "yes" must do nothing: only the "Yes, pay" button pays.
11. Send a request, and while the "Shall I pay" card is showing, leave it for 5 minutes. Expect it to lapse with nothing paid. (Skip if short of time.)

## Part 2. Merchant end: shilling prices

Open http://localhost:5174 in another tab at full width, signed in with the admin account.

### M1. The console
1. Expect the venue name with a blue checkmark beside it, and no green "Verified" label.
2. Expect a small blue dot before "SokoniPay for shops".
3. Expect "Daily statement" and "Admin" in the top bar, and your profile photo. There is no "Sign out" button.
4. Click the photo. Expect a menu with your name and email, the shop's NEAR account with "Copy" and "View on NEAR", "Open the customer app", and "Sign out". Close it.
5. Expect the accent colour to be pure blue, and to be used sparingly: the main button on a card, a few links and the focus outline. Report it if large areas are blue or if it is hard to read.
6. Expect all money on the page in KES.

### M2. Set round prices
1. Click "Tickets and hours" in the top bar. Under "Your tickets", the price column is headed "Price, KES". The existing prices are odd numbers left by a conversion (for example Adult 260).
2. Click "Edit" on Adult, type `250`, click "Save". Do the same for Child: `100`. Student: `150`.
3. Expect the table to show 250, 100 and 150 within a few seconds.
4. In the "Add" row, type `Senior` and `120`, and click "Add ticket". Expect it in the table. Edit it and click "Remove". Expect it gone.
5. Try to add a ticket with price `0`. Expect the button to stay greyed.
6. In the user tab, open the Arboretum from Shops. Expect "KES 250 each" for Adult, "KES 100 each" for Child and "KES 150 each" for Student.

### M2b. The console's layout
1. Expect a bar across the top that stays put when you scroll, with: "SokoniPay for shops", the sections "Overview", "Ticket sales", "Tickets and hours", "Discounts and split", then "Daily statement" and "Admin", and your profile photo on the right.
2. Click each section. Expect only that section's content below the venue name, and the current section shown as a black pill.
3. On "Overview" expect the Balance card in black with white text, the other figures in white cards, "At the gate", the latest 5 sales with "See all" (if there are more), "What your agent did", and the QR code on the right.
4. Headings should be in a heavier, slightly condensed display typeface, and body text and figures in a plain one. Report any text that falls back to a default serif or looks mismatched.

### M2c. Discount rules
1. Open "Discounts and split". Expect a "Discount rules" card that says "No rules yet, so your prices are final." (a venue starts with none).
2. Build a rule: When "The group is at least" `5` tickets, give up to `10` % off. Click "Add rule". Expect "Saved. Your agent uses these from the next order." and a line "up to 10% for groups of 5 or more".
3. Try to add a rule with 60%. Expect the button to stay greyed.
4. In the user tab buy 5 Adult. Expect the customer's agent to ask whether a discount applies, the venue's agent to answer "I can take 10% off for groups of 5 or more", and a ticket for KES 1,125 instead of KES 1,250.
5. Buy 1 Adult. Expect KES 250 and no discount.
6. Back in the console click "Remove" on the rule. Expect the "No rules yet" line again. (Remove it before Part 3, whose amounts assume no discount.)

### M3. Hours
1. Open "Tickets and hours".
2. Set the gate hours to `00:00` to `23:59` and click "Save hours" (skip this if they already are). Expect "Saved." and the header to read "Open 00:00 to 23:59, open now" without a reload.

---

## Part 3. User end: tickets, limits, adding and withdrawing money

Use the admin account in the user tab.

### U7. Sheets open from the bottom
1. On Home click "Limits". Expect a sheet that slides up from the bottom edge of the column and stays attached to the bottom, even at full window width. It must not appear in the middle of the screen.
2. Cancel. Click "Add money". Expect the same behaviour. Close it. Click "Withdraw". Same. Close it.

### U8. Set known limits
1. Read the "Agent spend limit today" card: "KES A of KES B". The amount already spent in the last 24 hours is B minus A. Write it down as S.
2. Click "Limits". Expect two boxes labelled "Per payment, in shillings" and "Per day, in shillings", and a sentence saying only you can change these and the agent's key can't withdraw or raise its own limits.
3. Set per payment to `2000` and per day to S + 3000. Save. Expect the card to read about "KES 3,000 of KES …" and "Up to KES 2,000 per payment." (KES 1 either way is fine.)
4. Open Limits again, set per payment higher than per day, and save. Expect "The per-payment limit can't be higher than the daily limit". Cancel.

### U9. Buy a ticket
1. Go to Shops and open the Arboretum. Expect the venue name, a line "Verified shop · <account>" with a blue checkmark, the place and the hours.
2. Pick 2 Adult and 1 Child. Expect "3 people" and a total of "KES 600". The button reads "Get 3 tickets".
3. Click it once. Expect the agents' conversation in shillings, then a ticket. Expect on the ticket:
   - the venue name, a short ticket number, "Valid" on green
   - "Valid until 11:59 PM · Now <a ticking clock>"
   - "Admits 3 people", "2 × Adult, 1 × Child"
   - "Paid KES 600" with a small sUSD figure in brackets
   - a QR code, and "It stops working at 11:59 PM today."
4. Write down the ticket number (it starts with `tkt-`). This is **ticket A**.
5. Go Home. Expect the balance down by KES 600, a red "−KES 600" line first in Recent payments, and ticket A under "Ready to show". Expect a small green dot on "Tickets" in the bottom bar.
6. Click the "Ready to show" row. Expect the ticket to open in place under it.

### U10. The limits hold
1. On the venue page pick 9 Adult (KES 2,250) and buy. Expect a red box: "The contract refused this payment", mentioning "over the per-payment limit", and the advice to order less or raise the limit. No money leaves.
2. Pick 7 Adult (KES 1,750) and buy. Expect a ticket. This is **ticket B**.
3. Pick 3 Adult (KES 750) and buy. Expect a refusal mentioning "over the daily limit".
4. Go Home. Expect the limit card to show about KES 650 left.
5. Open Limits and set per payment `5000`, per day S + 20000. Save.

### U11. Double clicks
1. On the venue page pick 1 Child. Click "Get my ticket" twice as fast as you can.
2. Expect exactly one ticket and one "−KES 100" line. If a message says "Your agent is already working on an order", that is correct too. This is **ticket C**.

### U12. Withdraw
1. Note the balance in sUSD (the small line under the big number). Call it D.
2. Click "Withdraw". Expect "You have D sUSD (KES …)" and a list of chains.
3. Pick "Base". Expect USDC chosen for you. Pick "Ethereum". Expect several coins to choose from. Go back to "Base".
4. Type an amount larger than D. Expect "Enter between 1.00 and your balance of D." and no price.
5. Type an amount that leaves about 2 dollars: D minus 2, rounded down to a whole number. Within a few seconds expect a box: "Leaves your balance … sUSD", "You would get … USDC on Base", a time, and "Live price from NEAR Intents."
6. Expect a box "4. Your Base address" and a greyed "Withdraw" button. Type `0x1111111111111111111111111111111111111111`. The button becomes active.
7. Click "Withdraw … sUSD" twice quickly. Expect one withdrawal: a large red "−<amount>", a sentence saying the money left the balance, and a grey note that no real USDC was sent because this is a demo on testnet. Click "Done".
8. Expect the balance to be about 2 dollars (around KES 260), and Activity to show a "Withdrawal" line with a round red arrow icon and a red "−KES …". The "Withdrawn" filter shows it.

### U13. Not enough money
1. On the venue page pick 2 Adult (KES 500) and buy.
2. Expect a refusal mentioning "insufficient SokoniPay balance" and the advice "Your balance is too low for this. Add money from your home screen, then try again." It must not suggest raising a limit.

### U14. Add money
1. Click "Add money". Expect chains listed first: Ethereum, Solana, Base, Arbitrum, Tron and about 20 more.
2. Pick "Ethereum". Expect its coins (DAI, USD1, USDC, USDT, USDf). Pick "Base". Expect USDC chosen for you.
3. Type `25`. Within a few seconds expect "You send 25.0 USDC on Base", "You get" just under 25.00 sUSD, "Conversion cost", a time, and "Live price from NEAR Intents."
4. Type `0.5`, then `30`. Each time expect "Enter between 1.00 and 25.00." and no price.
5. Pick "Tron", then USDT, amount `25`. Expect a red message from NEAR Intents about a minimum amount, and no button.
6. Go back to Base, amount `25`. Click "Try it with demo money: add … sUSD" twice quickly. Expect one large green "+24.99" (or close) and the words "No real coins moved". Click "Done".
7. Expect the balance to rise once, by about 25 dollars (about KES 3,250), and a green "Money added" line in Activity.
8. Repeat step 6 three more times so the balance is above 100 sUSD, then try once more. Expect "You already have 100 sUSD or more of demo money." and no change.

### U15. Pages that don't exist
1. Open http://localhost:5173/r/tkt-doesnotexist. Expect "There is no ticket or receipt with that number."
2. Open http://localhost:5173/shop/nobody.testnet. Expect "That shop is not on SokoniPay." and "Back to shops".
3. Open http://localhost:5173/nonsense. Expect the home screen.

---

## Part 4. Merchant end: the gate, refunds and the statement

Use the console tab (admin account).

### M4. Sales and the gate
1. Expect tickets A, B and C under "Ticket sales" as "Paid", in KES, with local Nairobi times, and the refusals as "Refused by contract".
2. In "At the gate", type ticket B's number and click "Check". Expect "Valid: 7 people to let in" and a line saying the ticket was sold to work until 11:59 PM.
3. Click "Just one". Expect "Let in. 1 of 7 are now in."
4. In the user tab, open Tickets and open ticket B. Within 10 seconds expect "1 of 7 already in" and "Admits 6 people", without reloading.
5. Check a ticket number that doesn't exist. Expect "That isn't one of your tickets."

### M5. Refunds
1. Under "Ticket sales", find ticket A (KES 600, nobody admitted). Click "Refund in full". Expect a confirmation box naming the amount and the customer. Cancel it. Expect nothing to change.
2. Click "Refund in full" again and confirm. Expect the label "Refunded" within about 15 seconds, the line struck through, the shop Balance down by KES 600, and a line in "What your agent did" starting "Refunded KES 600 in full".
3. In "At the gate", check ticket A. Expect it not to be valid for entry. Try to let people in if the app offers it: it must be refused.
4. In the user tab: expect the balance up by KES 600. In Activity expect both the original red "−KES 600" and a green "+KES 600" line marked "Ticket refunded". In Tickets, expect ticket A under the "Refunded" filter with a blue-grey square. Open it: expect a green note that the venue refunded it in full and it no longer opens the gate.
5. Open ticket A's page from Activity. Expect the same refund message, not a valid ticket.
6. Back in the console, click "Refund in full" on ticket B (one person is already in). Expect a red message: "Not refunded: someone has already gone in on this ticket." Ticket B stays "Paid".

### M6. The split
1. In "Split every sale", set savings `20` and partner `10`. Save. Expect "Saved. The next sale is split this way." and two new cards, Savings and Partner.
2. In the user tab buy 2 Adult (KES 500). This is **ticket D**.
3. Expect, in the console: Balance up by about KES 350, Savings up by about KES 100, Partner up by about KES 50.

### M7. The daily statement
1. Click "Daily statement". Expect the title "Daily statement", the venue name, today's date and "Nairobi time".
2. Expect four figures: "Sales", "Refunds", "Net for the day" (outlined) and "People" as "N of M in".
3. Check them against your notes for today's sales at this venue:
   - Sales = total of every paid ticket today, including ticket A before its refund.
   - Refunds = KES 600, "1 given back".
   - Net = Sales minus Refunds.
   - People: the "in" number counts everyone admitted today (at least 1).
4. Expect a card "Where the sales went" with "Shop balance", "Savings" and "Partner" in sUSD. Savings and Partner should match ticket D only (20% and 10% of it), because the split was set after the other sales.
5. Expect a table with one row per sale (time, customer, what was sold, people in, KES, sUSD), ticket A marked "later refunded", a separate "Refund" row in red, and a "Net for the day" total row.
6. Click "Download CSV". Expect a file named `sokonipay-<date>.csv`. If you can open it, expect a header row and one line per sale and refund.
7. Pick yesterday in the date box. Expect yesterday's sales, with no refunds. Pick a date with no sales. Expect "Nothing was sold or refunded on this day."
8. Click "← Back to the console".

### M8. Admin
1. Click "Admin". Expect both shops listed with local times, the profile photo top right, and "My shop".
2. Do not suspend anything.

---

## Part 5. The food stall, both ends

### F1. Shilling menu (merchant end, second account)
1. In the console tab open the profile menu and sign out. Sign in with the second Google account.
2. Expect "Mama Njeri's Kitchen (demo)" with a blue checkmark, a QR code that changes every 10 seconds, and **no** "At the gate" card.
3. Set round prices: Beef pilau `450`, Nyama choma `800`, Githeri bowl `350`, Chapati `80`, Sukuma wiki `150`, Masala chai `80`.
4. In the user tab (still the admin account), check the user is still signed in. Signing out of the console must not have signed the user app out.

### F2. Order by chat (user end, admin account)
1. Open the stall from Shops. Expect the menu in KES and suggestion chips including "Something for me, under 800".
2. Type `2 chapati and a masala chai` and send. Expect the agents to talk in shillings, and a receipt for KES 240 (or slightly less if a discount was agreed), with "Settled as … sUSD on NEAR" under the total.
3. Type `Lunch for me, under KES 500` and send. Expect an order whose total is KES 500 or less.
4. Expect both in the stall console under "Orders" as "Paid", in KES, and stock reduced.

### F3. Sold out
1. In the stall console set Chapati's stock to `0`.
2. In the user tab order `2 chapati`. Expect no payment and a message that Chapati is sold out and to pick something else.
3. Set the stock back to `20`.

### F4. Refund a food order
1. In the stall console click "Refund in full" on the KES 240 order and confirm.
2. Expect "Refunded", the stall balance down, Chapati and Masala chai stock back up, and in the user tab a green "+KES …" line marked "Refund".

### F5. Split a bill by link
1. In the user tab (admin account) choose 2 people and order `lunch for two`. Expect "Your share is paid. Waiting for 1 more." and a link to copy.
2. Open the link in the console tab's browser profile, or sign in to the user app as the second account in a private window. Expect the bill, "Your share" in KES and "Pay my share".
3. Pay. Expect a receipt showing both shares, and no "1 still to pay" line above it.

### F5b. The stall's discount rules
1. In the stall console open "Discounts and split". Expect existing rules for larger orders and groups.
2. Add: When "The customer has paid here at least" `1` times, give up to `8` % off.
3. In the user tab (admin account, who has paid here before) order `1 beef pilau`, which is under KES 1,000. Expect the stall's agent to offer a discount of at most 8% and to mention customers who have paid here before. The total must not be lower than KES 414.
4. Remove the rule.

### F5c. Subscriptions (stall console, then the admin user)
1. In the stall console open "Subscriptions". Expect "No plans yet." Add a plan: `Lunch club`, `150`, "every 5 minutes (for testing)". Expect it listed with "0 subscribers".
2. In the user tab open the stall from Shops. Expect a "Subscriptions" card with "Lunch club", "KES 150 every 5 minutes" and a "Subscribe" button.
3. Click "Subscribe". Expect a confirmation box naming the amount and period. Cancel it: nothing happens. Click again and confirm. Expect "Subscribed. View" within about 20 seconds.
4. Open "Subs" in the bottom bar. Expect "Lunch club", the stall's name, "KES 150 every 5 minutes" and a green "Active" label. Open it. Within about a minute expect the first payment listed in red, and "Next payment" about 5 minutes ahead.
5. Expect Activity to show a red "−KES 150" line marked "Lunch club, subscription", and the stall console to show "1 subscriber", a paid sale and a log line.
6. Click "Pause". Expect "Paused". Wait until the next payment time has passed by a minute. Expect **no** new payment. Click "Resume". Expect a payment within about a minute.
7. Withdraw so your balance is under KES 150 (see U12), and wait for the next payment time. Expect the label "Needs money", a red note saying your balance is too low, and an "Add money" button. Add money. Expect it to return to "Active" with a new payment within about a minute, without you doing anything else.
8. Click "Cancel" and confirm. Expect "Cancelled", and no further payments after another 6 minutes. The stall console shows "0 subscribers".
9. In the stall console click "Stop offering" on the plan. Expect it gone from the user's view of the stall.

### F6. The stall's statement
1. In the stall console open "Daily statement". Expect "Kept by the shop" in place of "People", today's orders, the refund from F4, and a net that matches.

---

## Part 6. Checks across both sites

1. **Money adds up (user).** Starting balance + money added + refunds received − payments − withdrawals = the balance shown. Work in sUSD where you can; in KES allow a few shillings of rounding.
2. **Money adds up (venue).** Balance + Savings + Partner now = the same total at the start + today's ticket sales − refunds.
3. **Sign-out is per site.** Signing out of one site leaves the other signed in (F1.4).
4. **Reload anywhere.** Reload Home, Tickets, Shops, Activity, a venue page, the console and the statement. Each comes back to the same place, signed in.
5. **Times.** Every time on the console, statement and admin page is Nairobi time, not three hours behind.
6. **Phone width.** At 400 px go through Home, Tickets, Shops, Activity, a venue page, the Add money sheet and the Withdraw sheet. Nothing is cut off, the four balance buttons fit on one row, and the bottom bar does not cover the last item when you scroll to the end.
7. **Short window.** Make the window about 640 px tall. On Home, expect to still be able to scroll the content under the Balance card far enough to read every card.
8. **Keyboard.** Tab through Home. Every button, the profile menu and the bottom bar can be reached and show a visible outline.
9. **Wording.** Note anything still shown in dollars where shillings are expected, and any "sUSD" that appears without a shilling amount beside it outside the Add money and Withdraw sheets.

---

## Do not test

- Real deposits with real coins. "Add money" should only ever offer the demo button.
- The camera. If no camera is available, the scanner should show a message and a box to paste a code.
- Opening a new shop, unless you have a third Google account (see below). Each of the two accounts already has one.

## Optional, with a third Google account: a counter

1. Sign in to the console with the third account. Expect three choices; pick "A counter or till". Expect a form with a business name and place, and no price list. Open it. Sign in as the admin and verify it on the admin page.
2. In the counter's console, on "Overview", expect a "Charge a customer" card. Type `1500` and `Diesel, 12 litres`, and click "Ask for payment". Expect a line "KES 1,500, Diesel, 12 litres, Waiting for the customer to scan" with a QR code and "Cancel".
3. In the user tab open the counter from Shops. Expect "Diesel, 12 litres", "KES 1,500" and a "Pay KES 1,500" button. Pay. Expect a receipt for KES 1,500, and in the console the amount gone from the waiting list and a paid sale.
4. Key in another amount and click "Cancel". Expect it to disappear, and the user's page to say "Waiting for the cashier".
5. Open the counter's page as a user with nothing keyed in, then key in an amount. Expect it to appear on the user's page within about 5 seconds without reloading.
- Do not suspend a shop, and do not delete tickets or menu items you did not add.

---

## Your report

Write it in this shape so it can be pasted back to the developer.

**1. Summary.** Three or four sentences: how far you got, what works, and the most serious problems. Say plainly what you could not test.

**2. Results: user end.** One row per step (U1 to U15, U6b, F2, F3, F5, F5c).

| Step | Result | What you saw |
|---|---|---|
| U1 | Pass / Fail / Partly / Skipped | One line. For anything but a pass, the exact words on screen. |

**3. Results: merchant end.** The same table for M1 to M8, F1, F4 and F6.

**4. Results: across both sites.** The same table for Part 6, items 1 to 9.

**5. Problems, most serious first.** For each one:
- Which end (user, merchant, admin) and which step.
- What you did just before it.
- What you expected and what happened instead.
- The exact error text, copied.
- Whether it happened again on a second try.

**6. Timings.** How long each of these took: buying a ticket (U9), a refusal (U10), a withdrawal (U12), adding money (U14), a refund (M5), a chat order (F2), loading the statement (M7).

**7. Money check.** Starting numbers, every amount spent, added, withdrawn and refunded, the balances you expected and the balances shown, for the admin user, the venue and the stall.

**8. Layout and design.** For each of these, say whether it behaved as described: the background, the frosted column, the fixed header, the fixed Balance card, the floating bottom bar, sheets opening from the bottom, tickets opening in place, the ticket colours, the square shop icons, the blue checkmark, and red and green amounts. Add anything cut off, overlapping, hard to read or awkward.

**9. Anything unexpected.** Numbers that changed on their own, data you did not create today, and steps where the expected result in this script looked wrong for the app.
