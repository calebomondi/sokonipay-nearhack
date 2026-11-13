# Test SokoniPay in the browser: user end and merchant end

You are testing a web app called SokoniPay. Work only in the browser. Do not open or change any files or code, and do not try to fix anything. Follow the steps, compare what you see with what is expected, and write the report described at the end.

## 1. Background

SokoniPay lets a customer's AI agent pay a shop's AI agent. Shops price in Kenya shillings (KES) and people see KES. Each payment settles in demo dollars ("sUSD") on the NEAR test network. No real money is involved anywhere.

**Where to test.** Use the hosted apps. They are what the hackathon judges will open.

| Site | Hosted address | On this computer instead |
|---|---|---|
| User app | https://sokonipay.up.railway.app | http://localhost:5173 |
| Merchant console | https://merchant-sokonipay.up.railway.app | http://localhost:5174 |
| Daily statement | the console address + `/statement` | |
| Admin page | the console address + `/admin` | |

The steps below say "the user app" and "the console". Both sets of addresses use the same database, so the same shops and balances appear in both. Use the local addresses only if the user tells you to.

**This is a clean start.** The database is empty: no users, no shops, no payments. Everything you see should be something you created in this test. Report anything else.

You need two Google accounts:

- The **admin** account (ask the user which one if you are not told). Only it can open the admin page and verify shops. In this test it becomes a customer, opens the venue "Nairobi Arboretum", and later opens a second shop.
- A **second** account. It opens the food stall "Mama Njeri's Kitchen" and pays one share of a split bill.

Rules the tests rely on:

- Sign-in is "Continue with Google" on both sites. Google shows an account chooser every time.
- Amounts are shown as "KES 1,274". Where the settlement amount matters, a small "sUSD" figure sits beside it. One dollar is about KES 130 and the rate is refreshed hourly, so a shilling amount worked out from dollars can be off by KES 1.
- The user's agent can only spend inside two limits the user sets: per payment and per day. The day is a rolling 24 hours, so yesterday evening's spending may still count.
- A ticket covers everyone it was bought for and stops working at the closing time written on it when it was sold.
- Only the owner can refund, withdraw, subscribe or change limits. An agent cannot.
- One Google account can own up to five shops.
- All times are Nairobi time (East Africa Time, UTC+3).

How to work:

- A new user starts with 50.00 sUSD (about KES 6,500), limits of about KES 2,600 per payment and KES 5,200 per day, and nothing else. A new shop starts with a balance of KES 0. All money checks are against these.
- Steps that write to the NEAR network take time. Most take 3 to 15 seconds. An order placed by chat takes 30 to 60 seconds. Wait up to 90 seconds before calling something stuck.
- When a step fails, copy the exact words on screen, try once more, then carry on with the next step that does not depend on it.
- Keep a list of every amount spent, added, withdrawn and refunded.
- Note the time each timed step takes.

Do the parts in order:

0. Part 0: set up one user and one venue.
1. Part 1: user end, layout and navigation.
2. Part 2: merchant end, the console and the shop's profile.
3. Part 3: user end, a shop's page, tickets, limits and money.
4. Part 4: user end, chat with your agent.
5. Part 5: merchant end, the gate, refunds, money and the statement.
6. Part 6: the food stall, both ends (second Google account).
7. Part 7: a second shop on one account (a counter).
8. Part 8: checks across both sites.

---

## Part 0. Set up one user and one venue

### S0.1 First sign-in as a user
1. Open the user app. Before signing in, expect the SokoniPay mark (a violet "S" with two leaves) at the top, the heading "Your agent pays the shop's agent.", three white cards and a black "Continue with Google" button.
2. Sign in with the admin account. Expect a "Welcome" screen with four steps ticking off (a NEAR account, demo money, limits, the agent's key), then the home screen in about 20 to 30 seconds.
3. Expect a balance of about KES 6,500 with "50.00 sUSD on NEAR", "Agent spend limit today" at about KES 5,200 of KES 5,200, "Up to KES 2,600 per payment", "No shops yet…" under Shops, and "Nothing yet…" under Recent payments.

### S0.2 Open the venue
1. Open the console in another tab at full width and sign in with the admin account. Expect "What are you opening?" with three choices, each with an icon: "A park, venue or event", "A food stall or kitchen", "A counter or till".
2. Pick the venue. Expect a step line "1 Type, 2 Name and place, 3 Tickets", a form on the left, and on the right "How customers will see it": a preview card that fills in as you type.
3. With the name empty, expect "Next: tickets" to be greyed. Type the name `Nairobi Arboretum`, the place `State House Road, Nairobi`, and the description `A forest park in the city. Walking trails, picnic lawns and over 350 tree species.` Set the gate hours to `06:00` to `23:59`. Expect all of it in the preview, with a pin icon and a clock icon.
4. Click "Next: tickets". Click "Start with rows for: Adult, Child, Student". Expect three rows with names and empty prices. Type `250`, `100` and `150`. Expect the three tickets and prices in the preview. Expect "Open my venue" to be greyed until at least one row has a name and a price.
5. Click "Open my venue". Expect "Opening your shop" with four steps, then the console in about 25 seconds.
6. Expect "Not verified yet", an amber banner saying it is waiting for SokoniPay, and a grey box where the code will be. In the user app, reload: the venue must **not** be listed yet.

### S0.3 Verify it
1. In the console click "Admin". Expect the venue listed as "Venue", "Pending", with a "Verify shop" button, and "Customers 1".
2. Click "Verify shop". Expect "Approved" in about 10 seconds. Click "My shop".
3. Expect a blue checkmark beside the name, the framed code on the right, and a checklist "You're open".
4. In the user app, reload. Expect "Nairobi Arboretum" under Shops with a blue checkmark.

---

## Part 1. User end: layout and navigation

Use the user app, signed in with the admin account.

### U1. The frame
1. Expect the SokoniPay mark as the browser tab's icon.
2. Signed in, with the window about 1280 px wide, expect a background of faint outline shapes scattered at different angles, and the app in a frosted column in the middle with rounded corners.
3. Scroll the content. Expect the background shapes not to move.
4. Make the window 400 px wide. Expect the column to fill the window edge to edge, with nothing cut off. Go back to full width.

### U2. Home
1. Expect, from the top:
   - Your Google profile photo in a circle (initials if the account has no photo), "Hi, <first name>" and the NEAR account name.
   - A "Balance" card: "KES" in small type, the amount large, and "… sUSD on NEAR" small underneath.
   - Four round buttons in the card: "Scan", "Add money", "Withdraw", "Limits".
   - If a ticket is still valid: "Ready to show" with one ticket row.
   - A card titled "Agent spend limit today" with "KES … of KES …", a bar, and one line: "Up to KES … per payment."
   - "Shops" with up to 4 shops and "All shops".
   - "Recent payments" with at most 5 lines and "View all".
2. Scroll down. Expect the header and the whole Balance card to stay still while the rest scrolls beneath them.
3. Expect a pill-shaped bar floating at the bottom with five items: Home, Tickets, Subs, Chat, Activity. It stays still while you scroll, and the list fades out behind it. The current item is tinted and its icon is filled.
4. In "Recent payments", expect money out as red "−KES …" and money in as green "+KES …".

### U3. The profile menu
1. Click the profile photo. Expect a menu with: your name and email; a "NEAR account" box with "Copy" and "View on NEAR"; "Agent limits"; "Add money"; "Withdraw"; "Open my shop"; and "Sign out" in red at the bottom.
2. Click "Copy". Expect "Copied". Press Escape: the menu closes. Open it and click outside: it closes.
3. Open Tickets, Subs, Chat and Activity in turn. Expect **no** profile photo on any of them. It appears on Home only.

### U4. Shops list
1. On Home click "All shops". Expect the title "Shops", your balance in small type, a search box and a black "Scan" button. These stay still when the list scrolls.
2. Expect each shop to have a square icon with rounded corners and its initials, each shop in its own soft colour, and a blue checkmark right after the name of a verified shop.
3. Expect the venue's icon to carry a small dot: green when open, grey when closed.
4. Expect one shop for now. After Part 3, come back: the shop you paid most recently is first, and each shop you have paid says "paid once" or "paid N times".
5. Type `arbor`. Expect only the Arboretum. Type `zzz`. Expect "No shop matches that. If you're at the shop, scan its code." Clear the box.

### U5. Tickets
1. Click "Tickets". Expect filter pills that stay still: "All", "Active", "Used", "Expired", "Refunded", each with a count. There are no tickets yet: expect "No tickets yet…". **Do steps 2 to 4 after Part 3**, when you have tickets.
2. Expect every ticket row to be a white card that starts with a coloured rounded square: green with a tick (active), grey (used), orange with a clock (expired), blue-grey with a return arrow (refunded).
3. Click each filter. Expect only tickets of that kind, and the count to match the rows. An empty filter says "No <kind> tickets."
4. Click a ticket row. Expect the full ticket to open directly under that row, with the rows below sliding down. The page address must not change. Click a second ticket: the first closes. Click "Hide": it closes.

### U6. Activity
1. Click "Activity". Expect filter pills that stay still: "All", "Tickets", "Orders", "Money in", "Withdrawn", and "Nothing here yet." **Do steps 2 and 3 after Part 3.**
2. Expect lines grouped under "Today", "Yesterday" or a dated heading, newest first, each with a time in Nairobi time.
3. Click each filter. Expect only matching lines. Click a payment line: expect its receipt or ticket page. Use the browser's back button to return.

---

## Part 2. Merchant end: the console and the shop's profile

Use the console, signed in with the admin account.

### M1. The floating bar
1. Expect a rounded bar that stays at the top when you scroll, with: the SokoniPay mark; the sections "Overview", "Ticket sales", "Tickets", "Subscriptions", "Settings"; then "Daily statement" and "Admin"; a button showing the shop's initials and name; and your profile photo.
2. Click each section. Expect only that section's content below, and the current section shown as a black pill.
3. Expect the same faint scattered-shapes background as the user app.
4. Expect pure blue to be used sparingly: the main button on a card, a few links, the focus outline and the "Ask your agent" button. Report it if large areas are blue.

### M2. The shop's profile card
1. Below the bar, expect a card showing the shop as customers see it: a coloured square with "NA", "Nairobi Arboretum" with a blue checkmark, "Park or venue", the description you typed, then a pin icon with the place, a clock icon with "Open now" and "06:00 to 23:59", and a shield icon with the NEAR account.
2. Click "Edit". Expect the card to turn into a form: the description with a counter out of 200, the place, and the opening hours.
3. Add ` Open every day.` to the end of the description. Click "Save".
4. Expect the form to close and the card to show the new description without a reload.
5. Delete the whole description and save. Expect a dashed box inviting you to add one. Click it, put the description back, and save.
6. Click "Edit", change something, then "Cancel". Expect nothing to change.
7. Click "Edit", set opening and closing to the same time and save. Expect "Opening and closing time can't be the same."  Cancel.

### M3. Set round prices
1. Click "Tickets". The price column is headed "Price, KES". Expect Adult 250, Child 100 and Student 150.
2. Click "Edit" on Student, type `160`, "Save". Expect 160. Set it back to `150`.
3. Add `Senior` at `120`, then edit it and click "Remove". Expect it added, then gone.
4. Try to add a ticket with price `0`. Expect the button to stay greyed.

### M4. Overview: cards and charts
Nothing has been sold yet, so the figures are zero and the charts are empty. Check the layout now, and **come back after Part 3** to check the numbers (steps 3, 4, 6, 7 and 8).

1. Click "Overview". Expect four cards in a row:
   - "Balance" on black, with the amount, "… sUSD on NEAR" and a white "Withdraw" button.
   - "Today" with today's sales in KES, the number of sales, a small up or down chip against yesterday, and a trend line.
   - "Average sale" with a KES figure, "Over the last 14 days" and a trend line.
   - "Customers today" with a number, how many had paid here before, and a trend line.
2. Expect a "Sales" chart with a net total, a "7 days / 14 days / 30 days" switch, bars for each day with today's bar in blue, and a dashed "average" line.
3. Click "7 days" and "30 days". Expect the bars, the total and the axis labels to change.
4. Hover a bar. Expect a dark box with the date, "Sales", "Number of sales", "Net" and "Customers".
5. Expect "Today against a usual day": a blue filled curve for today, a dotted grey line for the average, and a sentence saying how today compares. With little history the sentence may say there is nothing to compare with yet.
6. Expect "What sells": one bar divided into shares, then a list with quantity, amount and percentage. The percentages should add up to about 100.
7. Expect "How payments ended": Paid, Refunded and Refused, each with a number.
8. Check the "Today" figure against the Daily statement's "Sales" for today (Part 5). They must match.

### M5. Discount rules
1. Click "Settings". Expect "Discount rules" (saying "No rules yet, so your prices are final." if there are none) and "Split every sale".
2. Add a rule: When "The group is at least" `5` tickets, give up to `10` % off. Expect "Saved. Your agent uses these from the next order." and "up to 10% for groups of 5 or more".
3. Try to add a rule with 60%. Expect the button to stay greyed.
4. Leave the rule in place for Part 3.

---

## Part 3. User end: a shop's page, tickets, limits and money

Use the admin account in the user app.

### U7. The shop's page
1. From "All shops" open the Arboretum. Expect a card at the top, before any tickets:
   - the coloured square, the name with a blue checkmark, and "Park or venue"
   - the description you typed in M2
   - a pin icon with the place
   - a clock icon with "Open now" in green and "closes 23:59"
   - a shield icon with "Verified shop" and the NEAR account
   - a tag icon with "Offers a discount for groups of 5 or more. Your agent asks." It must **not** show a percentage.
   - "You've paid here N times" if you have
2. Below it expect "How many tickets?" with "KES 250 each" for Adult, "KES 100 each" for Child and "KES 150 each" for Student.

### U8. Set known limits
1. On Home read the "Agent spend limit today" card: "KES A of KES B". The amount already spent in the last 24 hours is B minus A. Write it down as S. On a fresh account S is 0.
2. Click "Limits". Expect a sheet that slides up from the bottom edge of the column and stays attached to the bottom, even at full window width. Expect two boxes in shillings and a sentence saying only you can change these.
3. Set per payment to `2000` and per day to S + 3000. Save. Expect the card to read about "KES 3,000 of KES …" and "Up to KES 2,000 per payment."
4. Open Limits again, set per payment higher than per day, and save. Expect "The per-payment limit can't be higher than the daily limit". Cancel.

### U9. Buy a ticket
1. On the Arboretum page pick 2 Adult and 1 Child. Expect "3 people" and "KES 600". Click "Get 3 tickets" once.
2. Expect the agents' conversation in shillings, then a ticket: the venue name, a short number, "Valid" on green, "Valid until 11:59 PM · Now <a ticking clock>", "Admits 3 people", "Paid KES 600", a QR code.
3. Write down the ticket number (it starts with `tkt-`). This is **ticket A**.
4. On Home expect the balance down by KES 600, a red "−KES 600" line, ticket A under "Ready to show", and a green dot on "Tickets" in the bottom bar.

### U10. A discount inside the owner's rule
1. Pick 5 Adult (KES 1,250) and buy. Expect the customer's agent to ask whether a discount applies, the venue's agent to answer "I can take 10% off for groups of 5 or more", and a ticket for **KES 1,125**. This is **ticket B**.
2. Pick 1 Adult and buy. Expect KES 250 with no discount. This is **ticket C**.

### U11. The limits hold
1. Pick 9 Adult and buy (KES 2,250, or KES 2,025 after the discount: both are over KES 2,000). Expect a red box "The contract refused this payment", mentioning "over the per-payment limit". No money leaves.
2. Pick 4 Adult (KES 1,000) and buy. Expect a ticket. Then pick 4 Adult again. Expect a refusal mentioning "over the daily limit".
3. Open Limits and set per payment `5000`, per day S + 20000. Save.

### U12. Double clicks
1. Pick 1 Child. Click "Get my ticket" twice as fast as you can.
2. Expect exactly one ticket and one "−KES 100" line. A message "Your agent is already working on an order" is also correct.

### U13. Withdraw
1. Note the balance in sUSD (the small line under the big number). Call it D.
2. Click "Withdraw". Expect a sheet from the bottom, "You have D sUSD (KES …)", and a list of chains, each with its logo.
3. Pick "Base". Expect USDC chosen for you, with its logo. Pick "Ethereum": expect several coins with logos. Go back to "Base".
4. Type an amount larger than D. Expect "Enter between 1.00 and your balance of D." and no price.
5. Type D minus 2, rounded down. Within a few seconds expect "Leaves your balance … sUSD", "You would get … USDC on Base", a time and "Live price from NEAR Intents."
6. Type the address `0x1111111111111111111111111111111111111111`. Click "Withdraw … sUSD" twice quickly. Expect one withdrawal: a large red "−<amount>" and a grey note that no real USDC was sent because this is a demo. Click "Done".
7. Expect the balance to be about 2 dollars (around KES 260), and Activity to show a "Withdrawal" line in red. The "Withdrawn" filter shows it.

### U14. Not enough money
1. Pick 2 Adult (KES 500) and buy. Expect a refusal mentioning "insufficient SokoniPay balance" and the advice to add money from the home screen. It must not suggest raising a limit.

### U15. Add money
1. Click "Add money". Expect chains with logos: Ethereum, Solana, Base, Arbitrum, Tron and about 20 more. A few small chains show initials in a grey circle instead of a logo.
2. Pick "Base", type `25`. Expect "You send 25.0 USDC on Base", "You get" just under 25.00 sUSD, "Conversion cost", a time and "Live price from NEAR Intents."
3. Type `0.5`, then `30`. Each time expect "Enter between 1.00 and 25.00." and no price.
4. Pick "Tron", USDT, `25`. Expect a red message from NEAR Intents about a minimum amount, and no button.
5. Go back to Base, `25`. Click "Try it with demo money: add … sUSD" twice quickly. Expect one large green "+24.99" (or close) and "No real coins moved". Click "Done". Expect the balance to rise once, by about KES 3,250, and a green "Money added" line in Activity.
6. Repeat step 5 until the balance is above 100 sUSD, then try once more. Expect "You already have 100 sUSD or more of demo money."

### U16. Pages that don't exist
1. Open the user app at `/r/tkt-doesnotexist`. Expect "There is no ticket or receipt with that number."
2. Open `/shop/nobody.testnet`. Expect "That shop is not on SokoniPay." and "Back to shops".
3. Open `/nonsense`. Expect the home screen.

---

## Part 4. User end: chat with your agent

### C1. The chat screen
1. Click "Chat". Expect a focused screen: a header with "Chats", the chat's title and "New chat"; the messages; and the box to type in with a send button **at the very bottom** of the column. The bottom bar is not shown here.
2. Expect a slim handle on the left edge of the column, halfway down. Click it. Expect a narrow vertical bar to slide out with Home, Tickets, Subs, Chat and Activity stacked, Chat highlighted, and the rest dimmed. Click outside: it slides back. Open it, click "Home", then return to Chat from the bottom bar.
3. Click "New chat". Expect the title "New chat" and a card "Ask your agent" with four suggestions.

### C2. Questions
1. Click "What's my balance?". Expect your message on the right, three moving dots, then within about 15 seconds an answer with your balance and limits in KES. Check the figures against Home.
2. Type `Raise my daily limit to 50000`. Expect it to say it can't change limits and to point to Home. The limits must not change.

### C3. Buying, with a confirmation
1. Type `Get me 2 adult tickets at the Arboretum`. Expect, in order:
   - small grey lines "Looking through verified shops" and "Talking to Nairobi Arboretum's agent"
   - an open card "Your agent and Nairobi Arboretum's agent" showing both agents' messages
   - an outlined card "Shall I pay Nairobi Arboretum?", "2 × Adult", the total, "Not now", "Yes, pay" and a countdown
2. Check the balance in another tab: **nothing has been paid yet**.
3. Click "Not now". Expect "You said no. Nothing was paid." and an answer saying so. The balance is unchanged.
4. Send the same request and click "Yes, pay". Expect the payment, a ticket in the chat, and an answer saying it paid. The balance drops by KES 500.
5. On the conversation card click "Hide", then "Read". Expect it to fold and unfold.
6. Type `Find me something to eat`. No food stall exists yet. Expect the agent to say so and to name what the venue does sell. It must not invent a shop or pay anything. (After Part 6, ask `Find me something to eat under KES 500`: expect it to choose the food stall, say why, and stop at "Shall I pay" with a total of KES 500 or less. Click "Not now".)

### C4. Separate chats
1. Reload and open Chat. Expect the same chat to open with its messages.
2. Click "Chats". Expect your conversations newest first, each with a title from its first message and a date. A chat in which something was paid has a green dot. The open chat is outlined.
3. Open an older chat: expect its messages. Click "New chat" and ask `What did I just buy?`. Expect an answer from your payments, not from another chat's messages.
4. In "Chats" click the bin on a chat and confirm. Expect it gone. Its payments are still in Activity.

### C5. Voice (needs a microphone and speakers; skip if you have neither)
1. Expect a round microphone button left of the box, and a speaker button in the header.
2. Click the microphone, allow it, say "What is my balance?" and click the red square. Expect "Working out what you said…", then your words as a normal message and an answer.
3. Click the speaker so it is highlighted and ask a question. Expect the answer read aloud, with amounts spoken as "shillings". Click it off: the audio stops.
4. Under an agent message click "Listen". Expect it read aloud.
5. With the speaker on, ask for tickets. Expect the agent to ask aloud whether to pay. Saying "yes" must do nothing: only the "Yes, pay" button pays.

---

## Part 5. Merchant end: the gate, refunds, money and the statement

Use the console (admin account, the Arboretum).

### M6. Sales and the gate
1. Click "Ticket sales". Expect today's tickets as "Paid", in KES, with Nairobi times, and the refusals as "Refused by contract". Each row lines up its status, amount and a "Refund in full" button.
2. On "Overview", in "At the gate", type ticket B's number and click "Check". Expect "Valid: 5 people to let in". Click "Just one". Expect "Let in. 1 of 5 are now in."
3. In the user app open Tickets and open ticket B. Within 10 seconds expect "1 of 5 already in", without reloading.
4. Check a number that doesn't exist. Expect "That isn't one of your tickets."

### M7. Refunds
1. On ticket A (KES 600, nobody admitted) click "Refund in full". Expect a confirmation naming the amount and the customer. Cancel: nothing changes.
2. Click again and confirm. Expect "Refunded" within about 15 seconds, the line struck through, and the Balance down by KES 600.
3. In the user app: expect the balance up by KES 600, a green "+KES 600" line marked "Ticket refunded" in Activity, and ticket A under the "Refunded" filter in Tickets.
4. Look at ticket B (one person is in). Expect no refund button on it: in its place, "Can't refund: 1 of 5 already in". This shows on both Overview and Ticket sales.
5. Every confirmation in both apps is a sheet drawn by the app (from the bottom on a phone, centred on a wide screen), never a browser dialog. Escape or a click outside it cancels.

### M8. The split, savings and withdrawing
1. In "Settings" → "Split every sale", set savings `20` and partner `10`. Save. Expect "Saved. The next sale is split this way."
2. In the user app buy 2 Adult (KES 500).
3. On "Overview" expect Balance up by about KES 350, and new cards "Savings" (about KES 100) and "Partner" (about KES 50).
4. On the Savings card click "Move to balance". Expect Savings to drop to KES 0 and Balance to rise by the same amount within about 15 seconds.
5. On the Balance card click "Withdraw". Expect the same sheet as in the user app. Pick Base, an amount of `2`, the address from U13, and withdraw. Expect a red "−2.00", a note that no real coins were sent, and the Balance down by about KES 260.

### M9. The code and the poster
1. On "Overview" expect a framed code on the right: the shop's name with a checkmark above it, a QR code drawn with round dots and coloured corner markers with "NA" in the centre, and "Verified on SokoniPay" with the mark below.
2. Click the code. Expect the shop's page to open in the user app in a new tab.
3. If you can scan it with a phone, expect the same page.
4. Click "Print the poster". In the print preview expect only a large title, the framed code and one line of instructions. Cancel the dialog.

### M10. Ask your agent
1. Expect a blue "Ask your agent" button at the bottom right on every section. Click it. Expect a panel to slide in from the right, with the console still visible beside it.
2. Click "How did we do today?". Expect, within about 20 seconds, an answer with today's real sales figure and a comparison with yesterday. Check the figure against the "Today" card.
3. Type `Refund the last sale`. Expect it to say it can't and to name the section that does. Nothing is refunded.
4. Type `What sells best?`. Expect "Adult" with a figure.
5. Click "Chats": expect your conversation listed. Click "New chat". Close the panel with the ✕ or Escape.

### M11. The daily statement
1. Click "Daily statement". Expect today's date and "Nairobi time", and four figures: "Sales", "Refunds", "Net for the day" and "People".
2. Check against your notes: Sales is every paid ticket today including ticket A; Refunds is KES 600; Net is the difference.
3. Expect "Where the sales went" with the shop balance, Savings and Partner, and a table with one row per sale, ticket A marked "later refunded", and a red "Refund" row.
4. Click "Download CSV". Expect a file named `sokonipay-<date>.csv`.
5. Pick yesterday, then a date with no sales. Expect "Nothing was sold or refunded on this day."

### M12. Admin
1. Click "Admin". Expect the venue with a Nairobi time, and the latest orders. Do not suspend anything.

---

## Part 6. The food stall, both ends

### F1. Open the stall (second account), then verify it (admin)
1. In the console open the profile menu and sign out. Sign in with the second Google account. Expect "What are you opening?". There is no "Admin" link for this account.
2. Pick "A food stall or kitchen". Name `Mama Njeri's Kitchen`, place `Stall 9, Gikomba Market`, description `Home-style Kenyan lunches, cooked fresh every morning.` Tick "Show opening hours on my page" and set `08:00` to `20:00`.
3. Click "Next: menu". Add six rows: Beef pilau, Main, `450`; Nyama choma, Main, `800`; Githeri bowl, Main, `350`; Chapati, Side, `80`; Sukuma wiki, Side, `150`; Masala chai, Drink, `80`. Click "Open my stall". Expect the console in about 25 seconds, "Not verified yet".
4. Open the console address + `/admin`. Expect "This page is for SokoniPay admins."
5. Sign out of the console, sign in as the admin, open "Admin", and click "Verify shop" on the stall. Sign out, and sign back in with the second account.
6. Expect "Mama Njeri's Kitchen" with a checkmark, "Food and drink · Agent: …", a code that changes every 10 seconds, and **no** "At the gate" card. In "Settings" expect three discount rules already there (for larger orders and groups).
7. In the user app (still the admin account), check you are still signed in. Signing out of the console must not sign the user app out.

### F2. Order by chat
1. In the user app open the stall. Expect the header card with the description, the place, the hours, and suggestion chips including "Something for me, under 800".
2. Type `2 chapati and a masala chai`. Expect a receipt for KES 240 (or slightly less if a discount was agreed), with "Settled as … sUSD on NEAR".
3. Type `Lunch for me, under KES 500`. Expect a total of KES 500 or less.

### F3. Sold out
1. In the stall console set Chapati's stock to `0`. In the user app order `2 chapati`. Expect no payment and a message that Chapati is sold out. Set the stock back to `20`.

### F4. Refund and split
1. In the stall console refund the KES 240 order. Expect "Refunded", stock back up, and a green "+KES …" line in the user app.
2. In the user app choose 2 people and order `lunch for two`. Expect "Your share is paid. Waiting for 1 more." and a link. Open the link in a private window and sign in with the second account. This is that account's first time in the user app, so expect the "Welcome" steps first, then the bill with "Your share" in KES. Click "Pay my share". Expect a receipt showing both shares.

### F5. Subscriptions
1. In the stall console open "Subscriptions". Add `Lunch club`, `150`, "every 5 minutes (for testing)". Expect it listed with "0 subscribers".
2. In the user app open the stall. Expect a "Subscriptions" card. Click "Subscribe" and confirm. Expect "Subscribed. View" within about 20 seconds.
3. Open "Subs". Expect "Lunch club", "KES 150 every 5 minutes" and a green "Active". Open it: within about a minute expect the first payment in red and "Next payment" about 5 minutes ahead. Activity shows "−KES 150" marked "Lunch club, subscription".
4. Click "Pause". Wait past the next payment time: expect **no** payment. Click "Resume": expect one within about a minute.
5. Withdraw until your balance is under KES 150 and wait for the next payment time. Expect "Needs money" and an "Add money" button. Add money. Expect "Active" and a new payment within about a minute.
6. Click "Cancel" and confirm. Expect "Cancelled" and no further payments. In the stall console click "Stop offering" on the plan.

### F6. The stall's agent and statement
1. In the stall console click "Ask your agent" and ask `Is anything running low?`. Expect an answer from the stall's stock figures.
2. Open "Daily statement". Expect "Kept by the shop" in place of "People", today's orders and the refund.

---

## Part 7. A second shop on one account (a counter)

Sign in to the console with the admin account.

### S1. Open another shop
1. Click the button with the shop's name in the bar. Expect "Your shops" listing the Arboretum only, and "Open another shop".
2. Click "Open another shop". Expect "What is the new shop?" with three choices, each with an icon. Pick "A counter or till".
3. Expect a step line "1 Type, 2 Name and place", a form, and on the right "How customers will see it": a preview card that fills in as you type, with the shop's own coloured code.
4. Type the name `Kilimani Service Station`, a place and a description. Expect all three in the preview. Click "Open my counter". Expect "Opening your shop" with four steps, then the new shop's console in about 25 seconds.
5. Expect "Not verified yet", a banner saying it is waiting, and no code.
6. Open the shop switcher. Expect both shops, with the counter marked "waiting to be verified". Switch to the Arboretum and back. Expect each shop's own figures.

### S2. Verify it and take a payment
1. Go to "Admin". Expect three shops: the venue, the stall and the counter, with the counter listed as "Counter" and pending. Click "Verify shop". Expect "Approved" in about 10 seconds. Click "My shop" and switch to the counter.
2. Expect a checklist "You're open", a "To hand over" card with a "Read payments aloud" button, and an "Or key in an amount" card.

### S3. The price list
1. Open "Price list". Add `Diesel`, `125`, `litre`. Add `Bread`, `65`, `loaf`, and tick "Whole only". Expect both rows, with "litre" and "loaf, whole only" under "For each".

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

## Part 8. Checks across both sites

1. **Money adds up (user).** Starting balance + money added + refunds received − payments − withdrawals = the balance shown. Work in sUSD where you can; in KES allow a few shillings of rounding.
2. **Money adds up (venue).** Balance + Savings + Partner now = the same total at the start + today's ticket sales − refunds − withdrawals.
3. **Sign-out is per site.** Signing out of one site leaves the other signed in.
4. **Reload anywhere.** Reload Home, Tickets, Subs, Chat, Activity, a shop page, the console and the statement. Each comes back to the same place, signed in, and the console to the same shop.
5. **Times.** Every time on the console, statement and admin page is Nairobi time.
6. **Phone width.** At 400 px go through Home, Tickets, Subs, Chat, Activity, a shop page, and the Add money and Withdraw sheets. Nothing is cut off, the four balance buttons fit on one row, and the bottom bar does not cover the last item.
7. **Narrow console.** At 800 px wide the floating bar wraps without overlapping, and the charts stay readable.
8. **Short window.** At about 640 px tall, the Home content under the Balance card can still be scrolled far enough to read every card.
9. **Keyboard.** Tab through Home and the console's Overview. Every button, menu and chart control can be reached and shows a visible outline.
10. **Wording.** Note anything still shown in dollars where shillings are expected, outside the Add money and Withdraw sheets.

---

## Do not test

- Real deposits with real coins. "Add money" should only ever offer the demo button.
- The camera. If no camera is available, the scanner shows a message and a box to paste a code.
- Do not suspend a shop, and do not delete tickets or menu items you did not add.

---

## Your report

Write it in this shape so it can be pasted back to the developer.

**1. Summary.** Three or four sentences: which addresses you tested (hosted or local), how far you got, what works, and the most serious problems. Say plainly what you could not test.

**2. Results: user end.** One row per step (S0.1, U1 to U16, C1 to C5, F2 to F5).

| Step | Result | What you saw |
|---|---|---|
| U1 | Pass / Fail / Partly / Skipped | One line. For anything but a pass, the exact words on screen. |

**3. Results: merchant end.** The same table for S0.2, S0.3, M1 to M12, F1, F6 and S1 to S6.

**4. Results: across both sites.** The same table for Part 8, items 1 to 10.

**5. Problems, most serious first.** For each one:
- Which end (user, merchant, admin) and which step.
- What you did just before it.
- What you expected and what happened instead.
- The exact error text, copied.
- Whether it happened again on a second try.

**6. Timings.** How long each of these took: buying a ticket (U9), a refusal (U11), a withdrawal (U13), adding money (U15), a chat answer (C2), a chat purchase (C3), a refund (M7), the merchant agent's answer (M10), opening a second shop (S1), a subscription's first payment (F5).

**7. Money check.** Starting numbers, every amount spent, added, withdrawn and refunded, the balances you expected and the balances shown, for the admin user, the venue and the stall.

**8. Layout and design.** For each of these, say whether it behaved as described: the logo, the background, the frosted column, the fixed header and Balance card, the floating bottom bar, sheets opening from the bottom, tickets opening in place, the chat's bottom input and side drawer, the shop's header card with its icons, the console's floating bar, the profile card and its Edit form, the metric cards, the four charts, the styled code and poster, and the agent panel. Add anything cut off, overlapping, hard to read or awkward.

**9. Anything unexpected.** Numbers that changed on their own, data you did not create today, and steps where the expected result in this script looked wrong for the app.
