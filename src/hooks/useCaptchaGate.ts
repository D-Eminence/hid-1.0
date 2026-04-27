import { useCallback, useEffect, useRef, useState } from 'react'
import { showToast } from '../components/ui'
import { ensureCaptchaReady, isTurnstileConfigured } from '../lib/captcha'

type CaptchaNoticeTone = 'error' | 'info'

type CaptchaGateOptions = {
  requiredMessage?: string
  unavailableMessage?: string
}

type PendingAction = (captchaToken: string | null) => void | Promise<void>

export function useCaptchaGate() {
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const [captchaVisible, setCaptchaVisible] = useState(false)
  const [captchaNotice, setCaptchaNotice] = useState<{ message: string; tone: CaptchaNoticeTone } | null>(null)
  const pendingActionRef = useRef<PendingAction | null>(null)
  const turnstileConfigured = isTurnstileConfigured()

  const resetCaptcha = useCallback(() => {
    pendingActionRef.current = null
    setCaptchaToken(null)
    setCaptchaVisible(false)
    setCaptchaNotice(null)
    setCaptchaResetKey(current => current + 1)
  }, [])

  const onTokenChange = useCallback((token: string | null) => {
    setCaptchaToken(token)
    if (token) {
      setCaptchaNotice(null)
      return
    }

    setCaptchaNotice(current => (
      current?.tone === 'error'
        ? current
        : current
          ? { ...current, message: 'Complete the security check below to continue.' }
          : null
    ))
  }, [])

  const runWithCaptcha = useCallback((action: PendingAction, options: CaptchaGateOptions = {}) => {
    if (ensureCaptchaReady(captchaToken)) {
      setCaptchaNotice(null)
      void action(captchaToken)
      return true
    }

    if (!turnstileConfigured) {
      const message = options.unavailableMessage ?? 'Security check is not configured right now. Please contact support.'
      setCaptchaNotice({ message, tone: 'error' })
      showToast(message, 'error')
      return false
    }

    pendingActionRef.current = action
    setCaptchaVisible(true)
    setCaptchaNotice({
      message: options.requiredMessage ?? 'Complete the security check below to continue.',
      tone: 'info',
    })
    return false
  }, [captchaToken, turnstileConfigured])

  useEffect(() => {
    if (!captchaToken || !pendingActionRef.current) return

    const action = pendingActionRef.current
    pendingActionRef.current = null
    void action(captchaToken)
  }, [captchaToken])

  return {
    captchaNotice,
    captchaResetKey,
    captchaToken,
    captchaVisible,
    onTokenChange,
    resetCaptcha,
    runWithCaptcha,
  }
}
