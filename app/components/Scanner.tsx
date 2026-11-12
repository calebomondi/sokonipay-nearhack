"use client";
import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";

/** Reads a shop's code with the camera. Falls back to pasting the code when there is no camera. */
export function Scanner({ onCode, onClose }: { onCode: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [pasted, setPasted] = useState("");

  useEffect(() => {
    let stream: MediaStream | undefined;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const tick = () => {
      const v = video.current;
      if (stopped || !v) return;
      if (v.readyState === v.HAVE_ENOUGH_DATA) {
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(v, 0, 0);
        const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
        if (code?.data) return onCode(code.data);
      }
      raf = requestAnimationFrame(tick);
    };
    (navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment" } }) ?? Promise.reject(new Error("no camera")))
      .then((s) => {
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          video.current.play().catch(() => {});
        }
        raf = requestAnimationFrame(tick);
      })
      .catch(() => setError("The camera isn't available here. Paste the shop's code instead."));
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-well/95 p-4" role="dialog" aria-label="Scan a shop's code">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Scan the shop&apos;s code</h2>
          <button onClick={onClose} className="rounded-full bg-cloth px-4 py-2 text-sm font-medium">Close</button>
        </div>
        <div className="relative aspect-square w-full overflow-hidden rounded-3xl bg-black">
          <video ref={video} playsInline muted className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-marigold" />
        </div>
        <p className="text-sm text-haze">The code only identifies the shop. Your location is never used.</p>
        {error && <p className="text-sm text-marigold">{error}</p>}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (pasted.trim()) onCode(pasted.trim());
          }}
        >
          <input
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Or paste the code's link"
            aria-label="Paste the shop's code"
            className="min-w-0 flex-1 rounded-xl border border-seam bg-well px-3 py-2.5 text-sm placeholder:text-haze"
          />
          <button className="rounded-xl bg-marigold px-4 py-2.5 text-sm font-semibold text-ink">Use code</button>
        </form>
      </div>
    </div>
  );
}
