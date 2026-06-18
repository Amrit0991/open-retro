// Vite resolves `?raw` imports to the file's text content at build/test time.
// This ambient declaration (script context — no imports) types them as strings.
declare module '*.sql?raw' {
  const content: string;
  export default content;
}
