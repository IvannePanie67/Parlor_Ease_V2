/* ParlorEase - Data Structures and Algorithms module
 * Hand-written implementations (no built-in sort / library structures).
 * Data structures : LinkedQueue, MinHeap (priority queue), Stack, HashMap, BST
 * Algorithms      : Merge Sort, Insertion Sort, Binary Search, Linear Search,
 *                   BST prefix search, Heap sift-up / sift-down
 */
(function (root) {
  "use strict";

  const cmpText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  /* ---------- DATA STRUCTURE 1: Queue (singly linked list, FIFO) ---------- */
  class LinkedQueue {
    constructor() { this.head = null; this.tail = null; this.length = 0; }
    enqueue(value) {                       // O(1)
      const node = { value, next: null };
      if (this.tail) this.tail.next = node; else this.head = node;
      this.tail = node; this.length++;
    }
    dequeue() {                            // O(1)
      if (!this.head) return undefined;
      const node = this.head;
      this.head = node.next;
      if (!this.head) this.tail = null;
      this.length--;
      return node.value;
    }
    peek() { return this.head ? this.head.value : undefined; }
    isEmpty() { return this.length === 0; }
    size() { return this.length; }
    toArray() { const out = []; for (let n = this.head; n; n = n.next) out.push(n.value); return out; }
  }

  /* ---------- DATA STRUCTURE 2: Stack (LIFO) ---------- */
  class Stack {
    constructor(limit = 50) { this.items = []; this.limit = limit; }
    push(value) {                          // O(1); oldest entry dropped past limit
      this.items.push(value);
      if (this.items.length > this.limit) this.items.shift();
    }
    pop() { return this.items.length ? this.items.pop() : undefined; }
    peek() { return this.items.length ? this.items[this.items.length - 1] : undefined; }
    isEmpty() { return this.items.length === 0; }
    size() { return this.items.length; }
    toArray() { return this.items.slice().reverse(); }   // top first
  }

  /* ---------- DATA STRUCTURE 3: Min-Heap (priority queue) ---------- */
  class MinHeap {
    constructor(compare) { this.data = []; this.compare = compare || cmpText; }
    size() { return this.data.length; }
    isEmpty() { return this.data.length === 0; }
    peek() { return this.data[0]; }
    push(value) {                          // O(log n)
      const d = this.data;
      d.push(value);
      let i = d.length - 1;                // sift-up
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (this.compare(d[i], d[parent]) >= 0) break;
        [d[i], d[parent]] = [d[parent], d[i]];
        i = parent;
      }
    }
    pop() {                                // O(log n)
      const d = this.data;
      if (!d.length) return undefined;
      const top = d[0], last = d.pop();
      if (d.length) {
        d[0] = last;
        let i = 0;                         // sift-down
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < d.length && this.compare(d[l], d[m]) < 0) m = l;
          if (r < d.length && this.compare(d[r], d[m]) < 0) m = r;
          if (m === i) break;
          [d[i], d[m]] = [d[m], d[i]];
          i = m;
        }
      }
      return top;
    }
  }

  /* ---------- DATA STRUCTURE 4: Hash Map (separate chaining) ---------- */
  class HashMap {
    constructor(capacity = 16) { this.buckets = new Array(capacity).fill(null); this.count = 0; }
    _hash(key) {                           // djb2
      const s = String(key); let h = 5381;
      for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
      return h % this.buckets.length;
    }
    _resize() {
      const old = this.buckets;
      this.buckets = new Array(old.length * 2).fill(null);
      this.count = 0;
      for (const head of old) for (let n = head; n; n = n.next) this.set(n.key, n.value);
    }
    set(key, value) {                      // O(1) average
      if (this.count / this.buckets.length > 0.75) this._resize();
      const i = this._hash(key);
      for (let n = this.buckets[i]; n; n = n.next) if (n.key === key) { n.value = value; return; }
      this.buckets[i] = { key, value, next: this.buckets[i] };
      this.count++;
    }
    setIfAbsent(key, value) { if (!this.has(key)) this.set(key, value); }
    get(key) {
      for (let n = this.buckets[this._hash(key)]; n; n = n.next) if (n.key === key) return n.value;
      return undefined;
    }
    has(key) { return this.get(key) !== undefined; }
    delete(key) {
      const i = this._hash(key);
      let prev = null;
      for (let n = this.buckets[i]; n; prev = n, n = n.next) {
        if (n.key === key) {
          if (prev) prev.next = n.next; else this.buckets[i] = n.next;
          this.count--; return true;
        }
      }
      return false;
    }
    size() { return this.count; }
  }

  /* ---------- DATA STRUCTURE 5: Binary Search Tree ---------- */
  class BST {
    constructor() { this.root = null; this.count = 0; }
    insert(key, value) {                   // O(log n) when balanced
      const node = { key, value, left: null, right: null };
      this.count++;
      if (!this.root) { this.root = node; return; }
      let cur = this.root;
      for (;;) {
        if (cmpText(key, cur.key) < 0) { if (!cur.left) { cur.left = node; return; } cur = cur.left; }
        else { if (!cur.right) { cur.right = node; return; } cur = cur.right; }
      }
    }
    search(key) {                          // exact match
      let cur = this.root;
      while (cur) {
        const c = cmpText(key, cur.key);
        if (c === 0) return cur.value;
        cur = c < 0 ? cur.left : cur.right;
      }
      return undefined;
    }
    prefixSearch(prefix) {                 // all values whose key starts with prefix, in sorted order
      const out = [];
      const walk = (n) => {
        if (!n) return;
        if (prefix <= n.key) walk(n.left);                       // prune: left subtree can't match if key < prefix
        if (n.key.startsWith(prefix)) out.push(n.value);
        if (n.key.slice(0, prefix.length) <= prefix || n.key.startsWith(prefix)) walk(n.right);
      };
      walk(this.root);
      return out;
    }
    inorder() { const out = []; const w = (n) => { if (n) { w(n.left); out.push(n.value); w(n.right); } }; w(this.root); return out; }
    height() { const h = (n) => (n ? 1 + Math.max(h(n.left), h(n.right)) : 0); return h(this.root); }
    size() { return this.count; }
    // Build a balanced tree from items already sorted by key (avoids a degenerate, list-like tree).
    static fromSorted(items, keyFn) {
      const tree = new BST();
      const build = (lo, hi) => {
        if (lo > hi) return null;
        const mid = (lo + hi) >> 1, item = items[mid];
        const node = { key: keyFn(item), value: item, left: null, right: null };
        node.left = build(lo, mid - 1);
        node.right = build(mid + 1, hi);
        return node;
      };
      tree.root = build(0, items.length - 1);
      tree.count = items.length;
      return tree;
    }
  }

  /* ---------- ALGORITHM 1: Merge Sort (stable, O(n log n)) ---------- */
  function mergeSort(arr, compare = cmpText) {
    if (arr.length <= 1) return arr.slice();
    const mid = arr.length >> 1;
    const left = mergeSort(arr.slice(0, mid), compare);
    const right = mergeSort(arr.slice(mid), compare);
    const out = []; let i = 0, j = 0;
    while (i < left.length && j < right.length) out.push(compare(left[i], right[j]) <= 0 ? left[i++] : right[j++]);
    while (i < left.length) out.push(left[i++]);
    while (j < right.length) out.push(right[j++]);
    return out;
  }

  /* ---------- ALGORITHM 2: Insertion Sort (stable, good for small lists) ---------- */
  function insertionSort(arr, compare = cmpText) {
    const a = arr.slice();
    for (let i = 1; i < a.length; i++) {
      const cur = a[i]; let j = i - 1;
      while (j >= 0 && compare(a[j], cur) > 0) { a[j + 1] = a[j]; j--; }
      a[j + 1] = cur;
    }
    return a;
  }

  /* ---------- ALGORITHM 3: Binary Search (sorted array, O(log n)) ---------- */
  function binarySearch(sorted, target, keyFn = (x) => x, compare = cmpText) {
    let lo = 0, hi = sorted.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, c = compare(keyFn(sorted[mid]), target);
      if (c === 0) return sorted[mid];
      if (c < 0) lo = mid + 1; else hi = mid - 1;
    }
    return undefined;
  }

  /* ---------- ALGORITHM 4: Linear Search (O(n)) ---------- */
  // Returns the index of the first match at or after `from`, or -1.
  function linearSearch(arr, predicate, from = 0) {
    for (let i = from; i < arr.length; i++) if (predicate(arr[i], i)) return i;
    return -1;
  }
  // Scans the whole list front to back and returns every matching index (repeated linear search).
  function linearSearchAll(arr, predicate) {
    const hits = [];
    for (let i = linearSearch(arr, predicate); i !== -1; i = linearSearch(arr, predicate, i + 1)) hits.push(i);
    return hits;
  }

  /* ---------- Applied helpers used by the app ---------- */
  // Service queue order: "Priority" customers first, then first-come-first-served by queue number.
  function buildServiceQueue(items) {
    const rank = (x) => (String(x.priority).toLowerCase() === "priority" ? 0 : 1);
    const heap = new MinHeap((a, b) => rank(a) - rank(b) || a.number - b.number);
    for (const it of items) heap.push(it);
    const ordered = [];
    while (!heap.isEmpty()) ordered.push(heap.pop());
    return ordered;
  }

  // Pending booking requests are handled first-come-first-served.
  function pendingFifo(items, limit) {
    const q = new LinkedQueue();
    for (const it of items) q.enqueue(it);
    const out = [];
    while (!q.isEmpty() && out.length < limit) out.push(q.dequeue());
    return out;
  }

  // Lookup indexes rebuilt whenever data reloads.
  const INDEX = { customerByName: new HashMap(), customerByEmail: new HashMap(), serviceByName: new HashMap(), servicesSorted: [], customerBst: new BST() };
  function rebuildIndexes(db) {
    INDEX.customerByName = new HashMap(); INDEX.customerByEmail = new HashMap(); INDEX.serviceByName = new HashMap();
    for (const c of db.customers) {
      INDEX.customerByName.setIfAbsent(c.name, c);
      INDEX.customerByEmail.setIfAbsent(String(c.email || "").toLowerCase(), c);
    }
    for (const s of db.services) INDEX.serviceByName.setIfAbsent(s.name, s);
    INDEX.servicesSorted = mergeSort(db.services, (a, b) => cmpText(a.name, b.name));
    const sortedCustomers = mergeSort(db.customers, (a, b) => cmpText(a.name.toLowerCase(), b.name.toLowerCase()));
    INDEX.customerBst = BST.fromSorted(sortedCustomers, (c) => c.name.toLowerCase());
  }

  const api = { LinkedQueue, Stack, MinHeap, HashMap, BST, mergeSort, insertionSort, binarySearch, linearSearch, linearSearchAll, buildServiceQueue, pendingFifo, rebuildIndexes, INDEX, cmpText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.DSA = api;
})(typeof window !== "undefined" ? window : globalThis);
