export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.message || 'Something went wrong')
    this.status = status
    this.fields = payload?.fields
    this.data = payload
  }
}

async function request(method, path, body, params) {
  const search = params
    ? new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')).toString()
    : ''
  let response
  try {
    response = await fetch(`/api${path}${search ? `?${search}` : ''}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, { message: 'Cannot reach the server. Check your connection.' })
  }
  if (response.status === 204) return null
  const text = await response.text()
  let payload
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    throw new ApiError(response.status, { message: 'The server sent an unexpected response.' })
  }
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login' && path !== '/auth/me') window.dispatchEvent(new Event('hms:signed-out'))
    throw new ApiError(response.status, payload?.error)
  }
  return payload
}

export const api = {
  get: (path, params) => request('GET', path, undefined, params),
  post: (path, body = {}) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  put: (path, body) => request('PUT', path, body),
  delete: (path) => request('DELETE', path),
}

/** Default fetcher: every query key is [path, params]. */
export const queryFn = ({ queryKey: [path, params] }) => api.get(path, params)
