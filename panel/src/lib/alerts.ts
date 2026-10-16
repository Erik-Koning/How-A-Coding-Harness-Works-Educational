import { useCallback, useEffect, useRef, useState } from 'react'
import type { TurnRecord } from '../types'

/**
 * A chime, and a desktop notification when the panel is not in front, each time
 * a new turn arrives.
 *
 * The tab title alone was not enough: with the panel already open, a new turn
 * changed nothing but a few characters in a background tab, and opencode looked
 * hung while it waited for a paste nobody knew was due.
 *
 * Alerts only ever announce. Nothing here copies, pastes or advances a turn.
 */

const STORAGE_KEY = 'copilot-bridge-alerts'

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

function writeEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // private window or blocked storage: the choice lasts until reload
  }
}

let audio: AudioContext | null = null

/** Browsers allow sound only after the person has interacted with the page, so
 *  the audio context is created (or resumed) on their first click or key. */
function unlockAudio(): void {
  try {
    audio ??= new AudioContext()
    if (audio.state === 'suspended') void audio.resume()
  } catch {
    // no Web Audio: the notification and the tab title still work
  }
}

/** Two short rising tones. */
function chime(): void {
  if (!audio || audio.state !== 'running') return
  const now = audio.currentTime
  ;[660, 880].forEach((freq, i) => {
    const osc = audio!.createOscillator()
    const gain = audio!.createGain()
    const start = now + i * 0.14
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.15, start + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35)
    osc.connect(gain).connect(audio!.destination)
    osc.start(start)
    osc.stop(start + 0.4)
  })
}

export type NotifyPermission = NotificationPermission | 'unsupported'

function currentPermission(): NotifyPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

function nextStep(turn: TurnRecord): string {
  return turn.systemPrompt
    ? `Start a new Copilot chat (chat ${turn.chat.label}) and paste it.`
    : `Paste it into chat ${turn.chat.label}.`
}

/**
 * @param loaded  true once the first snapshot has arrived. The turn on screen
 *                when the panel opens is not announced: opening the panel was
 *                the announcement.
 */
export function useTurnAlerts(turn: TurnRecord | null, loaded: boolean) {
  const [enabled, setEnabled] = useState(readEnabled)
  const [permission, setPermission] = useState<NotifyPermission>(currentPermission)
  const seen = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    window.addEventListener('pointerdown', unlockAudio)
    window.addEventListener('keydown', unlockAudio)
    return () => {
      window.removeEventListener('pointerdown', unlockAudio)
      window.removeEventListener('keydown', unlockAudio)
    }
  }, [])

  // Keyed on createdAt as well as id: turn ids start again from 1 when the shim
  // restarts, and a new turn_1 is still a new turn.
  const key = turn ? `${turn.id}@${turn.createdAt}` : null

  useEffect(() => {
    if (!loaded || key === seen.current) return
    const first = seen.current === undefined
    seen.current = key
    if (first || !turn || !enabled) return

    chime()
    if (permission === 'granted' && (document.hidden || !document.hasFocus())) {
      try {
        const n = new Notification(`Turn ${turn.turnIndex} is waiting`, {
          body: nextStep(turn),
          tag: 'copilot-bridge-turn',
        })
        n.onclick = () => {
          window.focus()
          n.close()
        }
      } catch {
        // some browsers only allow notifications from a service worker
      }
    }
  }, [key, loaded, enabled, permission, turn])

  const requestPermission = useCallback(() => {
    if (typeof Notification === 'undefined') return
    void Notification.requestPermission().then(setPermission)
  }, [])

  const toggle = useCallback(() => {
    const next = !enabled
    setEnabled(next)
    writeEnabled(next)
    // turning alerts on is the moment to ask, while the click still counts
    if (next && currentPermission() === 'default') requestPermission()
  }, [enabled, requestPermission])

  return { enabled, permission, toggle, requestPermission }
}
