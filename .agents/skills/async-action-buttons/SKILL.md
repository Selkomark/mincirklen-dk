---
name: async-action-buttons
description: Use whenever wiring a button (or similar control) to a backend call — create/join/submit/save/delete actions. Applies to services/web-app; the pattern is DS Button's isPending prop plus an inline error, never a toast.
---

Any control that triggers a backend request needs a visible pending state
and a failure path the user doesn't have to go looking for.

## The pattern

Use `Button`'s `isPending` prop (`services/web-app/src/components/Button`)
instead of hand-rolling a disabled/opacity treatment:

```tsx
const [isSubmitting, setIsSubmitting] = useState(false)
const [submitError, setSubmitError] = useState<string | null>(null)

async function confirm() {
  setSubmitError(null)
  setIsSubmitting(true)
  try {
    const res = await fetch('/api/trpc/session.join', { ... })
    if (!res.ok) throw new Error('Something went wrong joining this circle.')
    onComplete(...)
  } catch (err) {
    setSubmitError(err instanceof Error ? err.message : 'Something went wrong joining this circle.')
    setIsSubmitting(false) // only on failure — success navigates away, no need to re-enable
  }
}

return (
  <>
    {submitError && <Alert variant="urgent">{submitError}</Alert>}
    <Button variant="safe" isPending={isSubmitting} isDisabled={otherValidationFailed} onClick={confirm}>
      Join circle
    </Button>
  </>
)
```

`isPending` renders a `Spinner` (`components/Spinner`) alongside the
label and forces the button disabled — it doesn't need `isDisabled` added
on top for the pending case, only for independent validation state (e.g.
unchecked required checkboxes).

## Where the error goes

Put the `Alert` in the same card/section as the button that triggered the
action — not a toast (`components/Toast`/`addToast`). A toast renders
outside wherever the user's attention already is; right after clicking
"Join circle" their eyes are on that button, not wherever a toast
happens to appear. `StartNewPage.tsx`'s `confirm()` and
`StartJoinPage.tsx`'s `confirm()` are the reference implementations.

On failure, re-enable the button (`isPending` back to `false`) so the
user can retry without reloading. On success, it's fine to leave it
disabled/pending through a navigation — there's nothing left to click.
