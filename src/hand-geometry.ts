import { ARENA, ARENA_ASPECT, TRACKING } from './config.js'
import type { Point, Rectangle, Size } from './types.js'

export type FrameGeometry = {
  scale: Size
  play: Rectangle
}

type SpatialPoint = Point & { z: number }

function spatialDistance(a: SpatialPoint, b: SpatialPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

export function indexIsExtended(points: readonly SpatialPoint[]) {
  const wrist = points[0]
  const base = points[5]
  const pip = points[6]
  const dip = points[7]
  const tip = points[8]
  const middle = points[9]
  if (!wrist || !base || !pip || !dip || !tip || !middle) return false
  const palm = spatialDistance(wrist, middle)
  const finger = spatialDistance(base, pip) + spatialDistance(pip, dip) + spatialDistance(dip, tip)
  return palm > 0 && finger > 0 &&
    spatialDistance(tip, wrist) - spatialDistance(pip, wrist) > 0.12 * palm &&
    spatialDistance(base, tip) / finger >= 0.80
}

export function unit(value: number) {
  return Math.min(1, Math.max(0, value))
}

export function createFrameGeometry(size: Size): FrameGeometry {
  const longestSide = Math.max(size.width, size.height)
  const width = size.width / longestSide
  const height = size.height / longestSide
  const playWidth = Math.min(width, height * ARENA_ASPECT) * (1 - 2 * TRACKING.controlMargin)
  const playHeight = playWidth / ARENA_ASPECT

  return {
    scale: { width, height },
    play: {
      x: (width - playWidth) / 2,
      y: (height - playHeight) / 2,
      width: playWidth,
      height: playHeight,
    },
  }
}

export function previewPoint(point: Point, geometry: FrameGeometry): Point {
  return {
    x: unit(1 - point.x / geometry.scale.width),
    y: unit(point.y / geometry.scale.height),
  }
}

export function arenaPoint(point: Point, geometry: FrameGeometry): Point {
  const { play } = geometry
  return {
    x: unit(1 - (point.x - play.x) / play.width) * ARENA.width,
    y: unit((point.y - play.y) / play.height) * ARENA.height,
  }
}

export function previewGuide(geometry: FrameGeometry): Rectangle {
  const { play, scale } = geometry
  return {
    x: 1 - (play.x + play.width) / scale.width,
    y: play.y / scale.height,
    width: play.width / scale.width,
    height: play.height / scale.height,
  }
}
