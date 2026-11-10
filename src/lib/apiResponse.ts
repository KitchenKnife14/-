export interface ApiErrorEnvelope {
  message: string
}

export interface ApiResponseEnvelope<T> {
  data?: T
  error?: ApiErrorEnvelope | null
}

/** Parse and validate the JSON envelope returned by Google Apps Script. */
export function parseApiResponse<T>(text: string, httpStatus: number, httpOk: boolean): ApiResponseEnvelope<T> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Сервер вернул неожиданный ответ. Проверьте, что Apps Script опубликован с доступом «Все»')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Сервер вернул неполный или некорректный ответ')
  }

  const envelope = parsed as Record<string, unknown>
  const hasError = Object.prototype.hasOwnProperty.call(envelope, 'error') && envelope.error !== null
  if (hasError) {
    const error = envelope.error
    if (!error || typeof error !== 'object' || typeof (error as Record<string, unknown>).message !== 'string') {
      throw new Error('Сервер вернул некорректное описание ошибки')
    }
  } else if (!Object.prototype.hasOwnProperty.call(envelope, 'data')) {
    throw new Error('Сервер вернул неполный ответ без поля data')
  }

  if (!httpOk && !hasError) {
    throw new Error(`Сервер вернул HTTP ${httpStatus} без описания ошибки`)
  }

  return envelope as ApiResponseEnvelope<T>
}
