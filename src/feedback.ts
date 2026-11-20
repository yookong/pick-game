let audio: AudioContext | undefined
export function primeAudio() {
  try {
    if (!globalThis.AudioContext) return
    audio ??= new AudioContext()
    if (audio.state === 'suspended') void audio.resume().catch(() => {})
  } catch { /* audio is optional */ }
}
export function feedback(preferences: { sound: boolean; vibrate: boolean }) {
  if (preferences.vibrate) navigator.vibrate?.(45)
  if (!preferences.sound || !audio || audio.state !== 'running') return
  const tone = audio.createOscillator()
  const gain = audio.createGain()
  const now = audio.currentTime
  tone.frequency.setValueAtTime(520, now)
  tone.frequency.setValueAtTime(740, now + .07)
  gain.gain.setValueAtTime(.12, now)
  gain.gain.exponentialRampToValueAtTime(.001, now + .2)
  tone.connect(gain).connect(audio.destination)
  tone.start(now)
  tone.stop(now + .2)
}
