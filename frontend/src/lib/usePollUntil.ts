import { useEffect, useRef, useState } from 'react'

const FAST_INTERVAL_MS = 2_000
const SLOW_INTERVAL_MS = 5_000
const SWITCH_TO_SLOW_AFTER_MS = 30_000
const GIVE_UP_AFTER_MS = 120_000

// Rythme partagé entre la page destinataire (attente de scan) et l'écran
// d'attente de l'expéditeur (pas encore construit) : 2 s pendant les 30
// premières secondes, puis 5 s, abandon à 2 min. `active` déclenche/arrête le
// polling depuis l'appelant (ex: dès que l'état n'est plus `scanning`).
export function usePollUntil(callback: () => void, active: boolean): { timedOut: boolean } {
  const [timedOut, setTimedOut] = useState(false)
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (!active) {
      return
    }

    const start = Date.now()
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout>

    function tick() {
      if (cancelled) {
        return
      }
      const elapsed = Date.now() - start
      if (elapsed >= GIVE_UP_AFTER_MS) {
        setTimedOut(true)
        return
      }
      const interval = elapsed < SWITCH_TO_SLOW_AFTER_MS ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS
      timeoutId = setTimeout(() => {
        callbackRef.current()
        tick()
      }, interval)
    }

    tick()

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [active])

  return { timedOut }
}
