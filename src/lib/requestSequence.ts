export interface RequestSequence {
  begin(): number
  isCurrent(requestId: number): boolean
  invalidate(): void
}

export function createRequestSequence(): RequestSequence {
  let sequence = 0
  return {
    begin: () => ++sequence,
    isCurrent: (requestId) => requestId === sequence,
    invalidate: () => { sequence += 1 },
  }
}
