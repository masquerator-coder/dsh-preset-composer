/** Minimal CSS-Modules declaration for the client bundle's `*.module.css` imports. */
declare module '*.module.css' {
  /** Hashed local class map keyed by the authored class name. */
  const classes: Record<string, string>
  export default classes
}
