import jsQR from 'jsqr'
import { useEffect, useRef, useState } from 'react'
import { Button } from './ui'

/** Reads a shop's code with the camera, or takes a pasted link when there is no camera. */
export function Scanner({ onCode, onClose, title = 'Scan the shop’s code', hint = 'The code only identifies the shop. Your location is never used.' }: {
  onCode: (text: string) => void; onClose: () => void; title?: string; hint?: string
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const [pasted, setPasted] = useState('')
  const [seeing, setSeeing] = useState(false)

  useEffect(() => {
    let stream: MediaStream | undefined
    let raf = 0
    let stopped = false
    const canvas = document.createElement('canvas')
    const tick = () => {
      const v = video.current
      if (stopped || !v) return
      if (v.readyState === v.HAVE_ENOUGH_DATA) {
        setSeeing(true)
        canvas.width = v.videoWidth
        canvas.height = v.videoHeight
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(v, 0, 0)
        const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
        if (code?.data) return onCode(code.data)
      }
      raf = requestAnimationFrame(tick)
    }
    ;(navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } }) ?? Promise.reject(new Error('no camera')))
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop())
        stream = s
        if (video.current) {
          video.current.srcObject = s
          video.current.play().catch(() => {})
        }
        raf = requestAnimationFrame(tick)
      })
      .catch(() => setError('The camera isn’t available here. Type or paste the code instead.'))
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onCode])

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-canvas p-5" role="dialog" aria-label={title}>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">{title}</h2>
          <Button tone="quiet" onClick={onClose} className="!px-4 !py-2 text-sm">Close</Button>
        </div>
        <div className="relative aspect-square w-full overflow-hidden rounded-3xl bg-ink">
          <video ref={video} playsInline muted className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-10 rounded-2xl border-2 border-white/80" />
          {!seeing && (
            <p className="absolute inset-0 flex items-center justify-center px-14 text-center text-sm text-white/80">
              {error ? 'No camera' : 'Waiting for the camera. If your browser asks, allow it. No picture yet? Type or paste the code below.'}
            </p>
          )}
        </div>
        <p className="text-sm text-soft">{hint}</p>
        {error && <p className="text-sm font-medium text-bad">{error}</p>}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (pasted.trim()) onCode(pasted.trim())
          }}
        >
          <input
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Type or paste the code"
            aria-label="Type or paste the code"
            className="min-w-0 flex-1 rounded-full bg-card px-4 py-3 text-sm outline-none placeholder:text-soft focus:ring-2 focus:ring-iris"
          />
          <Button disabled={!pasted.trim()} className="text-sm">Open</Button>
        </form>
      </div>
    </div>
  )
}
