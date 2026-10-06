const prefix = '[font-manifest]'

/** Laravel mode is strict: every policy failure aborts the build. */
export function fail(message) {
  throw new Error(`${prefix} ${message}`)
}

export function list(values) {
  return values.length ? values.map((value) => `"${value}"`).join(', ') : 'none'
}
