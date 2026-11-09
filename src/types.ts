export type Point = { x: number; y: number }
export type Size = { width: number; height: number }
export type Rectangle = Point & Size
export type Stroke = { from: Point; to: Point }
export type TimedStroke = Stroke & { fromAt: number; toAt: number }

export type Screen = 'menu' | 'setup' | 'countdown' | 'playing' | 'paused' | 'result'
export type Control = 'mouse' | 'camera'
