// Records the dancer's panel while they practice, so their latest try can be
// watched back on the progress page next to the tutorial.

const TYPES = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4']

export class TakeRecorder {
  recorder = null
  chunks = []

  start(canvas) {
    this.cancel()
    if (!canvas?.captureStream || typeof MediaRecorder === 'undefined') return
    const type = TYPES.find((t) => MediaRecorder.isTypeSupported(t))
    try {
      this.recorder = new MediaRecorder(canvas.captureStream(30), { ...(type && { mimeType: type }), videoBitsPerSecond: 2_500_000 })
    } catch {
      this.recorder = null
      return
    }
    this.chunks = []
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data)
    this.recorder.start(1000)
  }

  /** Finish and hand back the clip (null if nothing was recording). */
  stop() {
    const recorder = this.recorder
    this.recorder = null
    if (!recorder || recorder.state === 'inactive') return Promise.resolve(null)
    return new Promise((resolve) => {
      recorder.onstop = () => resolve(this.chunks.length ? new Blob(this.chunks, { type: recorder.mimeType.split(';')[0] }) : null)
      recorder.stop()
    })
  }

  /** Throw the recording away (stopped early). */
  cancel() {
    const recorder = this.recorder
    this.recorder = null
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null
      recorder.stop()
    }
  }
}
