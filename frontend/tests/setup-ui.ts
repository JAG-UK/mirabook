import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { __reset } from '../src/lib/readerStore'

// jsdom implements neither createObjectURL nor revokeObjectURL. The reader
// revokes blob URLs on unmount, and Array.prototype.forEach throws when handed
// a non-function even for an empty array — so without these every unmount
// fails. Nothing here asserts on the values; they only need to be callable.
if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:test'
if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {}

// Unmount between tests so queries cannot match a previous render.
afterEach(cleanup)

// The reader mirror lives in a module-level map that outlives a render.
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  __reset()
})
