// Synthetic benchmark only. This is not the production JSON engine.
self.onmessage = (event: MessageEvent<string>): void => {
  const started = performance.now()
  const parsed: unknown = JSON.parse(event.data)
  const parsedAt = performance.now()
  const serialized = JSON.stringify(parsed)
  self.postMessage({
    parseMs: parsedAt - started,
    serializeMs: performance.now() - parsedAt,
    characters: serialized.length,
  })
}
