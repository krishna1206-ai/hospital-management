import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from './api.js'
import { moneyFormatter } from './format.js'

export const AuthContext = createContext(null)
export const ToastContext = createContext(() => {})

export const useAuth = () => useContext(AuthContext)
export const useToast = () => useContext(ToastContext)

export function useCan() {
  const { user } = useAuth()
  return useCallback((permission) => Boolean(user?.permissions.includes(permission)), [user])
}

export function useSettings() {
  const { data } = useQuery({ queryKey: ['/settings'], staleTime: 300000 })
  return data ?? {}
}

export function useMoney() {
  const { currency } = useSettings()
  return useMemo(() => moneyFormatter(currency || 'USD'), [currency])
}

/** Runs a mutation with toasts, then refreshes every query so all screens agree. */
export function useAction() {
  const client = useQueryClient()
  const toast = useToast()
  return useCallback(
    async (action, successMessage) => {
      try {
        const result = await action()
        await client.invalidateQueries()
        if (successMessage) toast(successMessage)
        return result
      } catch (error) {
        toast(error.message, 'error')
        throw error
      }
    },
    [client, toast],
  )
}

/** Starts the consultation and opens its note: one click from queue to charting. */
export function useStartVisit() {
  const action = useAction()
  const navigate = useNavigate()
  return async (row) => {
    if (row.status === 'checked_in') await action(() => api.post(`/appointments/${row.id}/status`, { status: 'in_progress' }))
    const note = await action(() => api.post('/clinical/encounters', { patient_id: row.patient_id, appointment_id: row.id }))
    navigate(`/encounters/${note.id}`)
  }
}

/** Beds free right now, as [id, label] options. */
export function useFreeBeds() {
  const money = useMoney()
  const { data } = useQuery({ queryKey: ['/ipd/bed-board'] })
  return (data?.wards ?? []).flatMap((ward) =>
    ward.beds
      .filter((bed) => bed.status === 'available')
      .map((bed) => [bed.id, `${ward.name}, bed ${bed.number} (${money(ward.daily_rate_cents)}/day)`]),
  )
}

export function useDebounced(value, delay = 250) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/** Server-paginated list with search; pass filters and they join the query. */
export function useList(path, { filters = {}, pageSize = 25, refetchInterval, enabled = true } = {}) {
  const [page, setPage] = useState(1)
  const [search, setSearchValue] = useState('')
  const q = useDebounced(search)
  const query = useQuery({
    queryKey: [path, { page, pageSize, q, ...filters }],
    placeholderData: keepPreviousData,
    refetchInterval,
    enabled,
  })
  const setSearch = useCallback((value) => {
    setSearchValue(value)
    setPage(1)
  }, [])
  return { ...query, page, setPage, search, setSearch, pageSize, resetPage: () => setPage(1) }
}

/** Options for selects, loaded once per mount and shared through the query cache. */
export function useOptions(path, { params, value = 'id', label = 'name', enabled = true } = {}) {
  const { data } = useQuery({ queryKey: [path, { pageSize: 100, ...params }], enabled, staleTime: 60000 })
  const rows = Array.isArray(data) ? data : (data?.rows ?? [])
  return rows.map((row) => ({ value: row[value], label: typeof label === 'function' ? label(row) : row[label], row }))
}

export function useTab(defaultTab) {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || defaultTab
  const setTab = useCallback((next) => setParams({ tab: next }, { replace: true }), [setParams])
  return [tab, setTab]
}

/** A clock for live "waiting 12 min" displays. */
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
