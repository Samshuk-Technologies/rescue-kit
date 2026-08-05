---
name: False positive
about: Rescue Kit flagged something that is actually fine
title: 'False positive: '
labels: false-positive
---

**Which rule?**
The rule id from the report, e.g. `auth/unprotected-route-handlers`.

**Smallest code sample that triggers it**

```ts
// The least code that still produces the finding.
```

**Why it's actually fine**
E.g. "the route is wrapped by `withAuth` in the parent layout".

**Environment**
- Rescue Kit version:
- Framework:

---

False positives are treated as bugs. Thanks for taking the time — a minimal repro makes
the fix considerably faster.
