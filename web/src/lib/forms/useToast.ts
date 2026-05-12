'use client'
/**
 * Minimal in-memory toast hook for success/error feedback from forms.
 *
 * Client-only. A module-level event bus + per-hook subscription keeps
 * the API tiny: any component calls `useToast()` and gets back a
 * `push(level, message)` function plus the currently-visible queue.
 * Render the queue wherever a host component wants the toasts to
 * appear — typically once in the dashboard shell.
 *
 * Deliberately NOT a portal-mounted overlay component — that's the
 * caller's job. We just give them a tiny state machine so a form can
 * say "show 'Saved'" without dragging in a notifications dep.
 */
import { useEffect, useState, useCallback } from 'react'

export type ToastLevel = 'success' | 'error' | 'info'
export type Toast = {
  id: number
  level: ToastLevel
  message: string
  createdAt: number
}

type Listener = (toasts: Toast[]) => void

let nextId = 1
let toasts: Toast[] = []
const listeners: Set<Listener> = new Set()
const TTL_MS = 4000

function emit(): void {
  for (const l of listeners) l(toasts)
}

function prune(): void {
  const now = Date.now()
  const before = toasts.length
  toasts = toasts.filter((t) => now - t.createdAt < TTL_MS)
  if (toasts.length !== before) emit()
}

export function pushToast(level: ToastLevel, message: string): void {
  const t: Toast = { id: nextId++, level, message, createdAt: Date.now() }
  toasts = [...toasts, t]
  emit()
  // Schedule a prune so the toast self-clears even with no listeners.
  setTimeout(prune, TTL_MS + 50)
}

export function useToast(): {
  toasts: Toast[]
  push: (level: ToastLevel, message: string) => void
  dismiss: (id: number) => void
} {
  const [snapshot, setSnapshot] = useState<Toast[]>(toasts)

  useEffect(() => {
    const l: Listener = (next) => setSnapshot(next)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])

  const push = useCallback((level: ToastLevel, message: string) => {
    pushToast(level, message)
  }, [])

  const dismiss = useCallback((id: number) => {
    toasts = toasts.filter((t) => t.id !== id)
    emit()
  }, [])

  return { toasts: snapshot, push, dismiss }
}
