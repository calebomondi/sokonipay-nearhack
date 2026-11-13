import { useEffect, useRef, useState } from 'react'
import { send } from './api'

export type Hearing = 'off' | 'asking' | 'on' | 'working'

const TICK_MS = 50
const CALIBRATE_MS = 300 // the room's own noise is measured first, so a busy till doesn't count as speech
const SPEECH_MS = 150 // this much sound above the noise counts as someone speaking, not a click or a cough
const SILENCE_MS = 1200 // after speech, this long quiet means they have finished
const NOTHING_MS = 6000 // no speech at all by now: stop without sending
const MAX_MS = 30_000

/**
 * Speak instead of typing. Tap to start; the recording stops by itself when the person stops talking,
 * and what was heard is passed to `onText`. Tapping again stops it at once.
 *
 * Speech is told apart from silence by loudness: the noise in the room is measured for a moment first,
 * and the voice has to rise clearly above it. `level` (0 to 1) is how loud it is right now, for drawing.
 */
export function useVoice(onText: (text: string) => void, onError: (message: string) => void) {
  const [hearing, setHearing] = useState<Hearing>('off')
  const [level, setLevel] = useState(0)
  const stop = useRef<((andSend: boolean) => void) | null>(null)
  // The latest callbacks, so a recording started before a re-render still reports to the current screen.
  const said = useRef(onText)
  const failed = useRef(onError)
  useEffect(() => { said.current = onText; failed.current = onError })
  useEffect(() => () => stop.current?.(false), []) // leaving the screen ends a recording without sending it

  async function start() {
    if (hearing === 'on') return stop.current?.(true)
    if (hearing === 'working' || hearing === 'asking') return
    let mic: MediaStream
    setHearing('asking') // the browser may be showing its own "allow the microphone?" question
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch {
      setHearing('off')
      return failed.current('The microphone isn’t available. Allow it in your browser, or type instead.')
    }
    const rec = new MediaRecorder(mic)
    const parts: Blob[] = []
    rec.ondataavailable = (e) => parts.push(e.data)

    const audio = new AudioContext()
    void audio.resume()
    const meter = audio.createAnalyser()
    meter.fftSize = 1024
    audio.createMediaStreamSource(mic).connect(meter)
    const samples = new Float32Array(meter.fftSize)

    let elapsed = 0
    let noise = 0
    let loud = 0 // how long the sound has been above the threshold
    let quiet = 0 // how long it has been quiet since the person last spoke
    let spoke = false
    let keep = true

    const finish = (andSend: boolean) => {
      if (!stop.current) return
      stop.current = null
      keep = andSend
      clearInterval(tick)
      setLevel(0)
      void audio.close().catch(() => {})
      if (rec.state === 'recording') rec.stop()
      else mic.getTracks().forEach((t) => t.stop())
    }
    stop.current = finish

    const tick = setInterval(() => {
      meter.getFloatTimeDomainData(samples)
      let sum = 0
      for (const s of samples) sum += s * s
      const rms = Math.sqrt(sum / samples.length)
      elapsed += TICK_MS
      if (elapsed <= CALIBRATE_MS) {
        noise = Math.max(noise, rms)
        return
      }
      const threshold = Math.max(0.012, noise * 2.5)
      setLevel(Math.min(1, rms / (threshold * 4)))
      if (rms > threshold) {
        loud += TICK_MS
        quiet = 0
        if (loud >= SPEECH_MS) spoke = true
      } else {
        loud = 0
        quiet += TICK_MS
      }
      if (spoke && quiet >= SILENCE_MS) finish(true)
      else if (!spoke && elapsed >= NOTHING_MS) {
        finish(false)
        failed.current('I didn’t hear anything. Tap the microphone and speak, or type instead.')
      } else if (elapsed >= MAX_MS) finish(true)
    }, TICK_MS)

    rec.onstop = async () => {
      mic.getTracks().forEach((t) => t.stop())
      if (!keep) return setHearing('off')
      setHearing('working')
      try {
        const form = new FormData()
        form.append('file', new Blob(parts, { type: rec.mimeType || 'audio/webm' }), 'speech')
        const { text } = (await (await send('/api/voice/transcribe', form)).json()) as { text: string }
        setHearing('off')
        if (text.trim()) said.current(text)
        else failed.current('I couldn’t make out any words. Try again, or type instead.')
      } catch (e) {
        setHearing('off')
        failed.current((e as Error).message)
      }
    }
    rec.start()
    setHearing('on')
  }

  return { hearing, level, listen: start }
}
