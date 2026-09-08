import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom implements neither createObjectURL nor revokeObjectURL. The reader
// revokes blob URLs on unmount, and Array.prototype.forEach throws when handed
// a non-function even for an empty array — so without these every unmount
// fails. Nothing here asserts on the values; they only need to be callable.
if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:test'
if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {}

// Unmount between tests so queries cannot match a previous render.
afterEach(cleanup)
