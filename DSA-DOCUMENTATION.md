# ParlorEase – Data Structures and Algorithms Documentation

All DSA code is hand-written in **`public/dsa.js`** (no built-in `Array.sort` or library structures) and used by **`public/app.js`**.

## Data Structures (5)

| # | Data structure | Why it was selected | Where it is used in the system |
|---|---|---|---|
| 1 | **Queue** (singly linked list, FIFO) | Booking requests must be handled first-come, first-served; enqueue/dequeue are O(1). | Dashboard → *Pending booking requests*: requests are enqueued in arrival order and dequeued to show the next 5 (`pendingFifo`). |
| 2 | **Min-Heap (priority queue)** | The salon serves "Priority" customers before regular ones, then by arrival number. A heap gives the next customer in O(log n). | Queue Management page: `buildServiceQueue` orders the waiting line; "Now Serving" and "Serve Next" use the heap's result. |
| 3 | **Stack** (LIFO) | The most recent action should be the first one shown or dismissed. | Dashboard → *Recent activity*: every add/update/delete/serve is pushed; "Dismiss latest" pops the top. |
| 4 | **Hash Map** (separate chaining, djb2 hash) | Looking up a customer by name or email, or a service by name, should be O(1) on average instead of scanning the whole list. | Adding a Queue entry or a Transaction (customer lookup by name); Customers search by email (`@`). |
| 5 | **Binary Search Tree** (balanced, built from sorted data) | Customer names are searched by what the admin types; a BST keeps names ordered and prunes whole branches. | Customers page search box: prefix search on customer names (`prefixSearch`). |

## Algorithms (4)

| # | Algorithm | Complexity | Why it was selected | Where it is used |
|---|---|---|---|---|
| 1 | **Merge Sort** | O(n log n), stable | Reliable for larger tables; stability keeps equal items in original order. | All table sorting (customers, staff, services, transactions) and the full appointments list. |
| 2 | **Insertion Sort** | O(n²) worst, O(n) nearly sorted | Best for short, mostly ordered lists. | A staff member's or customer's own appointments, ordered by date and time. |
| 3 | **Binary Search** | O(log n) | Fast exact lookup in a sorted array. | Finding a service by name (sorted service list) when adding a Queue entry or Transaction. |
| 4 | **Linear Search** | O(n) | Needed for free-text "contains" matching where no ordering helps. | Search box on Staff and Transactions: `linearSearchAll` scans every row in order and collects all matches. Also the fallback on Customers when no name starts with the typed text. |

## Other requirements

- **Add / update / delete / display:** every module (customers, staff, services, appointments, transactions, queue).
- **Search and sorting:** see algorithms above.
- **Data validation:** form checks (valid names, required fields, duplicate staff booking slot) plus database constraints.
- **Persistent storage:** SQLite database (`data/parlorease.db`) accessed only through the Express.js API.

## Testing

`dsa.js` was tested with randomized unit tests: both sorts against a reference sort (including stability), heap ordering over 500 random numbers, hash map insert/resize/delete over 1,000 keys, BST prefix search against a brute-force filter, queue and stack behavior, and both searches.
