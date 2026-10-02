# Your database

A business can connect the database it already runs on, and its assistant answers from it live:
where an order has got to, when a booking is, what is owed. Corva copies nothing. It keeps the
connection (encrypted) and the table and column names, and reads when someone asks.

It lives at **AI assistant → Your database** in the console (`/app/data`), for owners and admins.

## Two ways in, for two kinds of asker

| Who is asking | What they get |
|---|---|
| A customer, on website chat or a call | Only **lookups** the business has approved: fixed queries where the assistant fills in the values the customer gives |
| The business's own team, in the console | **Ask your database**: any question in words; the AI writes the query and it runs read-only |

A customer never reaches the second. The assistant talks to strangers, and a stranger who can
have a query written for them can ask for the whole customer table.

## Connecting

Postgres for now (Neon, Supabase, RDS, Railway, self-hosted). The database must accept
connections from the internet; local and private addresses are refused.

Give Corva a user that can only read, and only the tables the assistant should answer from:

```sql
CREATE USER corva_reader WITH PASSWORD 'choose-a-long-one';
GRANT USAGE ON SCHEMA public TO corva_reader;
GRANT SELECT ON orders, bookings TO corva_reader;
```

Paste `postgresql://corva_reader:…@host:5432/database` and press Connect. Corva checks it
answers, reads the tables, and stores the connection string sealed (AES-256-GCM under
`DATA_SOURCE_KEY`). It is never shown again and never sent to a browser.

After a schema change, press **Read tables again**.

## Lookups

A lookup is a name, a sentence saying when to use it, one `SELECT`, and the values it takes.

```sql
SELECT status, pickup_date, delivery_date, amount_paise / 100.0 AS amount_rupees
FROM orders
WHERE upper(reference) = upper(:reference)
ORDER BY created_at DESC
LIMIT 5
```

- Write `:name` where a value from the customer goes. Values are bound as parameters, never
  pasted into the query.
- A value's kind is text, number or **phone number**. A phone number arrives as its last ten
  digits, so compare it as `right(regexp_replace(phone, '\D', '', 'g'), 10) = :phone`.
- A lookup must take at least one value. Without one it would return the same rows to everybody.
- Only the columns selected are ever seen by the assistant. Leave out what a customer should
  not hear.
- For anything private, take two values (the reference *and* the phone number it was booked
  with), so knowing or guessing one is not enough.

**Suggest lookups** drafts some from the tables. Drafts are checked against the database and
arrive switched off. **Test** runs a draft with values you type. Nothing reaches the assistant
until a lookup is saved with **Let the assistant use this** ticked; from then it is live on chat
and on calls, as the tool `look_up_data`.

## Limits

| | Lookup (customer) | Ask (team) |
|---|---|---|
| Rows returned | 5 | 100 |
| Time allowed | 4 s | 8 s |
| Per conversation | 15 runs | — |

Every query runs inside a `READ ONLY` transaction, so the database refuses a write whatever the
query says. One database per business and twelve lookups, for now. Connecting, disconnecting,
lookup changes and each team question are written to the audit log; the connection string and
the rows are not.

## If something is wrong

| Symptom | Likely cause |
|---|---|
| "Connecting a database is not switched on" | `DATA_SOURCE_KEY` is not set on the deployment |
| "Could not reach the database" | It does not accept connections from the internet, or a firewall allow-list |
| "this user cannot see any tables" | The user has no `SELECT` grants |
| The assistant says the records could not be reached | The lookup failed at run time; the reason is in the server log under `[data]` |
| The saved connection could not be read | `DATA_SOURCE_KEY` changed. Connect the database again |

## Not yet

MySQL, MongoDB and Google Sheets; more than one database per business; lookups that write (take
a payment, move a booking).
