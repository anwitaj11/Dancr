import { useEffect, useState } from 'react'
import { api } from './api.js'

/** Obtain a short-lived, private video URL without putting a user token in the URL. */
export function usePrivateVideoUrl(id, enabled = true) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let active = true
    setUrl(null)
    if (id == null || !enabled) return () => { active = false }
    api.signedVideoUrl(id).then((value) => {
      if (active) setUrl(value)
    }).catch((error) => {
      if (active) console.warn('Could not load private dance video', error)
    })
    return () => { active = false }
  }, [id, enabled])
  return url
}
