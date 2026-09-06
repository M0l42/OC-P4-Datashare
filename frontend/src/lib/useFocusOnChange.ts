import { useEffect, type RefObject } from 'react'

// Moves focus to `ref` whenever `trigger` becomes a new truthy value.
// `role="alert"` already gets an error Callout announced by a screen reader
// on its own — this covers the sighted keyboard user, who needs focus itself
// to land on the error rather than having to tab around to find it.
export function useFocusOnChange(ref: RefObject<HTMLElement | null>, trigger: unknown) {
  useEffect(() => {
    const node = ref.current
    if (trigger) node?.focus()
  }, [trigger, ref])
}
